import type { QueryResult } from 'pg';
import type { Readable } from 'node:stream';
import { normalizeNodeName } from '@grandcharter/shared';
import { writeIncomingStreamToBlob } from '../storage/index.js';
import { ConflictError, InvalidMoveError, NotFoundError, NotDownloadableError } from './errors.js';

export type Queryable = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export type NodeRow = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  normalized_name: string;
  full_path_cache: string | null;
  depth: number;
  blob_id: string | null;
  size_bytes: string | null;
  mime_type: string | null;
  created_at: Date;
  updated_at: Date;
};

export type BlobRow = {
  id: string;
  sha256: string;
  storage_path: string;
  size_bytes: string;
  ref_count: number;
  created_at: Date;
};

function buildFullPath(parent: NodeRow | null, name: string): string {
  const base = parent?.full_path_cache === '/' ? '' : parent?.full_path_cache ?? '';
  return `${base}/${name}`.replace(/\/+/g, '/') || '/';
}

export async function createFolder(
  q: Queryable,
  params: { workspaceId: string; parentId: string | null; name: string }
): Promise<NodeRow> {
  const { workspaceId, parentId, name } = params;
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name cannot be empty');
  const normalizedName = normalizeNodeName(name);

  let parent: NodeRow | null = null;
  let depth = 0;
  let fullPathCache = '/' + trimmed;

  if (parentId) {
    const parentRes = await q.query(
      `SELECT id, workspace_id, kind, full_path_cache, depth FROM nodes WHERE id = $1 AND workspace_id = $2`,
      [parentId, workspaceId]
    );
    const row = parentRes.rows[0] as (NodeRow & { depth: number }) | undefined;
    if (!row) throw new NotFoundError('Parent folder not found');
    if (row.kind !== 'folder') throw new NotFoundError('Parent is not a folder');
    parent = row as NodeRow;
    depth = row.depth + 1;
    fullPathCache = buildFullPath(parent, trimmed);
  }

  try {
    const res = await q.query(
      `INSERT INTO nodes (workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth)
       VALUES ($1, $2, 'folder', $3, $4, $5, $6)
       RETURNING id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type, created_at, updated_at`,
      [workspaceId, parentId, trimmed, normalizedName, fullPathCache, depth]
    );
    return res.rows[0] as NodeRow;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') throw new ConflictError('A sibling with this name already exists');
    throw err;
  }
}

export async function createFileFromStream(
  q: Queryable,
  params: {
    workspaceId: string;
    parentId: string | null;
    filename: string;
    mimeType: string | null;
    stream: Readable;
  }
): Promise<{ node: NodeRow; blob: BlobRow }> {
  const { workspaceId, parentId, filename, mimeType, stream } = params;
  const trimmed = filename.trim();
  if (!trimmed) throw new Error('Filename cannot be empty');
  const normalizedName = normalizeNodeName(filename);

  let parent: NodeRow | null = null;
  let depth = 0;
  let fullPathCache = '/' + trimmed;

  if (parentId) {
    const parentRes = await q.query(
      `SELECT id, workspace_id, kind, full_path_cache, depth FROM nodes WHERE id = $1 AND workspace_id = $2`,
      [parentId, workspaceId]
    );
    const row = parentRes.rows[0] as (NodeRow & { depth: number }) | undefined;
    if (!row) throw new NotFoundError('Parent folder not found');
    if (row.kind !== 'folder') throw new NotFoundError('Parent is not a folder');
    parent = row as NodeRow;
    depth = row.depth + 1;
    fullPathCache = buildFullPath(parent, trimmed);
  }

  const { sha256, sizeBytes, storagePath } = await writeIncomingStreamToBlob(stream);

  // Caller must run this inside a transaction. Upsert is race-safe under concurrent identical uploads.
  const upsertRes = await q.query(
    `INSERT INTO blobs (sha256, storage_path, size_bytes, ref_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (sha256) DO UPDATE SET ref_count = blobs.ref_count + 1
     RETURNING id, sha256, storage_path, size_bytes, ref_count, created_at`,
    [sha256, storagePath, sizeBytes]
  );
  const blobRow = upsertRes.rows[0] as BlobRow;
  const blobId = blobRow.id;

  try {
    const nodeRes = await q.query(
      `INSERT INTO nodes (workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type)
       VALUES ($1, $2, 'file', $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type, created_at, updated_at`,
      [workspaceId, parentId, trimmed, normalizedName, fullPathCache, depth, blobId, sizeBytes, mimeType]
    );
    const node = nodeRes.rows[0] as NodeRow;
    return { node, blob: blobRow };
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') throw new ConflictError('A sibling with this name already exists');
    throw err;
  }
}

export async function listChildren(
  q: Queryable,
  workspaceId: string,
  parentId: string | null
): Promise<NodeRow[]> {
  const res = await q.query(
    `SELECT id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type, created_at, updated_at
     FROM nodes
     WHERE workspace_id = $1 AND (parent_id IS NOT DISTINCT FROM $2)
     ORDER BY (kind = 'folder') DESC, normalized_name`,
    [workspaceId, parentId]
  );
  return res.rows as NodeRow[];
}

function getNode(q: Queryable, nodeId: string, workspaceId: string): Promise<NodeRow | null> {
  return q
    .query(
      `SELECT id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type, created_at, updated_at
       FROM nodes WHERE id = $1 AND workspace_id = $2`,
      [nodeId, workspaceId]
    )
    .then((r) => (r.rows[0] as NodeRow) ?? null);
}

export async function renameNode(
  q: Queryable,
  params: { workspaceId: string; nodeId: string; newName: string }
): Promise<NodeRow> {
  const { workspaceId, nodeId, newName } = params;
  const node = await getNode(q, nodeId, workspaceId);
  if (!node) throw new NotFoundError('Node not found');

  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Name cannot be empty');
  const normalizedName = normalizeNodeName(newName);

  const conflictCheck = await q.query(
    `SELECT 1 FROM nodes
     WHERE workspace_id = $1 AND (parent_id IS NOT DISTINCT FROM $2) AND normalized_name = $3 AND id <> $4`,
    [workspaceId, node.parent_id, normalizedName, nodeId]
  );
  if (conflictCheck.rows.length > 0) throw new ConflictError('A sibling with this name already exists');

  let newPath: string;
  if (node.parent_id === null) {
    newPath = '/' + trimmed;
  } else {
    const parentRes = await q.query(
      `SELECT full_path_cache FROM nodes WHERE id = $1`,
      [node.parent_id]
    );
    const parentPath = (parentRes.rows[0] as { full_path_cache: string })?.full_path_cache ?? '';
    const base = parentPath === '/' ? '' : parentPath;
    newPath = `${base}/${trimmed}`.replace(/\/+/g, '/') || '/';
  }

  const oldPath = node.full_path_cache ?? '';

  await q.query(
    `UPDATE nodes SET name = $1, normalized_name = $2, full_path_cache = $3, updated_at = now()
     WHERE id = $4`,
    [trimmed, normalizedName, newPath, nodeId]
  );

  if (node.kind === 'folder' && oldPath !== '') {
    await q.query(
      `UPDATE nodes SET full_path_cache = $1 || substring(full_path_cache from length($2) + 1), updated_at = now()
       WHERE id IN (
         WITH RECURSIVE descendants AS (
           SELECT id FROM nodes WHERE parent_id = $3
           UNION ALL
           SELECT n.id FROM nodes n INNER JOIN descendants d ON n.parent_id = d.id
         )
         SELECT id FROM descendants
       )`,
      [newPath, oldPath, nodeId]
    );
  }

  const updated = await getNode(q, nodeId, workspaceId);
  return updated!;
}

export async function moveNode(
  q: Queryable,
  params: { workspaceId: string; nodeId: string; newParentId: string | null }
): Promise<NodeRow> {
  const { workspaceId, nodeId, newParentId } = params;
  const node = await getNode(q, nodeId, workspaceId);
  if (!node) throw new NotFoundError('Node not found');

  if (newParentId === nodeId) throw new InvalidMoveError('Cannot move a node into itself');

  type ParentRow = { id: string; kind: string; full_path_cache: string; depth: number };
  let parent: ParentRow | undefined;
  if (newParentId !== null) {
    const descRes = await q.query(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM nodes WHERE parent_id = $1
        UNION ALL
        SELECT n.id FROM nodes n INNER JOIN descendants d ON n.parent_id = d.id
      )
      SELECT id FROM descendants`,
      [nodeId]
    );
    const descendantIds = (descRes.rows as { id: string }[]).map((r) => r.id);
    if (descendantIds.includes(newParentId)) throw new InvalidMoveError('Cannot move a folder into its descendant');

    const parentRes = await q.query(
      `SELECT id, kind, full_path_cache, depth FROM nodes WHERE id = $1 AND workspace_id = $2`,
      [newParentId, workspaceId]
    );
    parent = parentRes.rows[0] as ParentRow | undefined;
    if (!parent) throw new NotFoundError('Target folder not found');
    if (parent.kind !== 'folder') throw new NotFoundError('Target is not a folder');
  }

  const conflictCheck = await q.query(
    `SELECT 1 FROM nodes
     WHERE workspace_id = $1 AND (parent_id IS NOT DISTINCT FROM $2) AND normalized_name = $3 AND id <> $4`,
    [workspaceId, newParentId, node.normalized_name, nodeId]
  );
  if (conflictCheck.rows.length > 0) throw new ConflictError('A sibling with this name already exists');

  let newDepth: number;
  let newPath: string;
  if (newParentId === null) {
    newDepth = 0;
    newPath = '/' + node.name;
  } else {
    newDepth = parent!.depth + 1;
    const base = parent!.full_path_cache === '/' ? '' : parent!.full_path_cache;
    newPath = `${base}/${node.name}`.replace(/\/+/g, '/') || '/';
  }

  const oldPath = node.full_path_cache ?? '';
  const oldDepth = node.depth;
  const depthDelta = newDepth - oldDepth;

  await q.query(
    `UPDATE nodes SET parent_id = $1, full_path_cache = $2, depth = $3, updated_at = now() WHERE id = $4`,
    [newParentId, newPath, newDepth, nodeId]
  );

  if (node.kind === 'folder' && oldPath !== '') {
    await q.query(
      `UPDATE nodes SET full_path_cache = $1 || substring(full_path_cache from length($2) + 1), depth = depth + $3, updated_at = now()
       WHERE id IN (
         WITH RECURSIVE descendants AS (
           SELECT id FROM nodes WHERE parent_id = $4
           UNION ALL
           SELECT n.id FROM nodes n INNER JOIN descendants d ON n.parent_id = d.id
         )
         SELECT id FROM descendants
       )`,
      [newPath, oldPath, depthDelta, nodeId]
    );
  }

  const updated = await getNode(q, nodeId, workspaceId);
  return updated!;
}

export type FileForDownload = {
  node: Pick<NodeRow, 'id' | 'name' | 'mime_type' | 'size_bytes'>;
  storagePath: string;
};

export async function getFileForDownload(
  q: Queryable,
  workspaceId: string,
  nodeId: string
): Promise<FileForDownload> {
  const res = await q.query(
    `SELECT n.id, n.kind, n.name, n.mime_type, n.size_bytes, b.storage_path
     FROM nodes n
     LEFT JOIN blobs b ON n.blob_id = b.id
     WHERE n.id = $1 AND n.workspace_id = $2`,
    [nodeId, workspaceId]
  );
  const row = res.rows[0] as { id: string; kind: string; name: string; mime_type: string | null; size_bytes: string | null; storage_path: string | null } | undefined;
  if (!row) throw new NotFoundError('Node not found');
  if (row.kind !== 'file' || row.storage_path == null) throw new NotDownloadableError('Folders cannot be downloaded');
  return {
    node: { id: row.id, name: row.name, mime_type: row.mime_type, size_bytes: row.size_bytes },
    storagePath: row.storage_path,
  };
}

export type SearchResultRow = {
  id: string;
  kind: string;
  name: string;
  full_path_cache: string | null;
  size_bytes: string | null;
  mime_type: string | null;
  updated_at: Date;
};

/** Escape % and _ for use in LIKE/ILIKE patterns (backend uses \ as escape). */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function searchNodes(
  q: Queryable,
  workspaceId: string,
  query: string
): Promise<SearchResultRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const normalized = normalizeNodeName(query);
  const likeArg = escapeLike(trimmed);
  const res = await q.query(
    `SELECT id, kind, name, full_path_cache, size_bytes, mime_type, updated_at
     FROM nodes
     WHERE workspace_id = $1
       AND (
         normalized_name = $2
         OR normalized_name LIKE $2 || '%'
         OR name ILIKE '%' || $3 || '%' ESCAPE '\\'
         OR (full_path_cache IS NOT NULL AND full_path_cache ILIKE '%' || $3 || '%' ESCAPE '\\')
       )
     ORDER BY
       CASE WHEN normalized_name = $2 THEN 0 WHEN normalized_name LIKE $2 || '%' THEN 1 ELSE 2 END,
       full_path_cache
     LIMIT 500`,
    [workspaceId, normalized, likeArg]
  );
  return res.rows as SearchResultRow[];
}
