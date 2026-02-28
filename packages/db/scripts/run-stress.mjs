/**
 * Stress/benchmark: seeds many nodes and times list, search, and move.
 * Run after migrations. Usage: cd packages/db && DATABASE_URL=... node scripts/run-stress.mjs
 * Does not touch blob storage; reuses one blob row for file nodes.
 */
import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  process.stderr.write('DATABASE_URL is required\n');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

function randomId(prefix) {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}${hex}`;
}

async function ensureBlob(client, blobId) {
  const sha256 = blobId.replace(/-/g, '').padEnd(64, '0').slice(0, 64);
  const storagePath = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
  await client.query(
    `INSERT INTO blobs (id, sha256, storage_path, size_bytes, ref_count)
     VALUES ($1, $2, $3, 0, 300)`,
    [blobId, sha256, storagePath]
  );
}

async function seed(client, workspaceId, rootId, blobId) {
  await client.query(
    `INSERT INTO nodes (id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type)
     VALUES ($1, $2, NULL, 'folder', 'stress-root', 'stress-root', '/stress-root', 0, NULL, NULL, NULL)`,
    [rootId, workspaceId]
  );
  for (let i = 0; i < 300; i++) {
    const name = `file-${i}.txt`;
    await client.query(
      `INSERT INTO nodes (workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type)
       VALUES ($1, $2, 'file', $3, $4, '/stress-root/' || $4, 1, $5, 0, 'text/plain')`,
      [workspaceId, rootId, name, name, blobId]
    );
  }
  let parentId = rootId;
  const nestedIds = [];
  for (let i = 0; i < 50; i++) {
    const id = randomId('f0000000-0000-4000-8000-');
    const name = `nested-${i}`;
    const path = i === 0 ? '/stress-root/nested-0' : nestedIds[nestedIds.length - 1].path + '/' + name;
    await client.query(
      `INSERT INTO nodes (id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth)
       VALUES ($1, $2, $3, 'folder', $4, $5, $6, $7)`,
      [id, workspaceId, parentId, name, name, path, i + 1]
    );
    nestedIds.push({ id, path });
    parentId = id;
  }
  return { rootId, moveTargetFolderId: nestedIds[40].id, moveSourceFolderId: nestedIds[45].id };
}

async function timeLabel(label, fn) {
  const start = performance.now();
  await fn();
  const ms = (performance.now() - start).toFixed(2);
  console.log(`${label}: ${ms} ms`);
  return Number(ms);
}

async function run() {
  const client = await pool.connect();
  const workspaceId = randomId('d0000000-0000-4000-8000-');
  const rootId = randomId('e0000000-0000-4000-8000-');
  const blobId = randomId('a0000000-0000-4000-8000-');
  try {
    console.log('Seeding stress data...');
    await ensureBlob(client, blobId);
    const { rootId: rId, moveTargetFolderId, moveSourceFolderId } = await seed(client, workspaceId, rootId, blobId);
    const rootIdFinal = rId;
    console.log('Running benchmarks...\n');

    await timeLabel('listChildren(root) x 5', async () => {
      for (let i = 0; i < 5; i++) {
        await client.query(
          `SELECT id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type, created_at, updated_at
           FROM nodes WHERE workspace_id = $1 AND (parent_id IS NOT DISTINCT FROM $2)
           ORDER BY (kind = 'folder') DESC, normalized_name`,
          [workspaceId, rootIdFinal]
        );
      }
    });

    await timeLabel('searchNodes(workspace, "file") x 5', async () => {
      const normalized = 'file';
      const likeArg = 'file';
      for (let i = 0; i < 5; i++) {
        await client.query(
          `SELECT id, kind, name, full_path_cache, size_bytes, mime_type, updated_at
           FROM nodes WHERE workspace_id = $1 AND (normalized_name = $2 OR normalized_name LIKE $2 || '%' OR name ILIKE '%' || $3 || '%' ESCAPE E'\\\\' OR (full_path_cache IS NOT NULL AND full_path_cache ILIKE '%' || $3 || '%' ESCAPE E'\\\\'))
           ORDER BY CASE WHEN normalized_name = $2 THEN 0 WHEN normalized_name LIKE $2 || '%' THEN 1 ELSE 2 END, full_path_cache LIMIT 500`,
          [workspaceId, normalized, likeArg]
        );
      }
    });

    await timeLabel('move subtree (rename path/depth)', async () => {
      const nodeId = moveSourceFolderId;
      const newParentId = moveTargetFolderId;
      const parentRes = await client.query(
        `SELECT full_path_cache, depth FROM nodes WHERE id = $1`,
        [newParentId]
      );
      const p = parentRes.rows[0];
      const newDepth = p.depth + 1;
      const newPath = (p.full_path_cache === '/' ? '' : p.full_path_cache) + '/nested-45';
      const nodeRes = await client.query(
        `SELECT full_path_cache, depth FROM nodes WHERE id = $1`,
        [nodeId]
      );
      const oldPath = nodeRes.rows[0].full_path_cache ?? '';
      const oldDepth = nodeRes.rows[0].depth;
      const depthDelta = newDepth - oldDepth;
      await client.query(
        `UPDATE nodes SET parent_id = $1, full_path_cache = $2, depth = $3, updated_at = now() WHERE id = $4`,
        [newParentId, newPath, newDepth, nodeId]
      );
      await client.query(
        `UPDATE nodes SET full_path_cache = $1 || substring(full_path_cache from length($2) + 1), depth = depth + $3, updated_at = now()
         WHERE id IN (WITH RECURSIVE descendants AS (SELECT id FROM nodes WHERE parent_id = $4 UNION ALL SELECT n.id FROM nodes n INNER JOIN descendants d ON n.parent_id = d.id) SELECT id FROM descendants)`,
        [newPath, oldPath, depthDelta, nodeId]
      );
    });

    console.log('\nStress run complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
