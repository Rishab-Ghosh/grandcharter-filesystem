import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { createPool } from '@grandcharter/db';
import { ensureStorageDirs } from '../storage/index.js';
import {
  createFolder,
  createFileFromStream,
  listChildren,
  renameNode,
  moveNode,
  getFileForDownload,
  searchNodes,
  ConflictError,
  InvalidMoveError,
  NotDownloadableError,
  NotFoundError,
} from './index.js';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL);

function randomWorkspaceId(): string {
  return crypto.randomUUID();
}

describe('filesystem service', { skip: !hasDb }, () => {
  let pool: ReturnType<typeof createPool>;
  let client: Awaited<ReturnType<ReturnType<typeof createPool>['connect']>>;
  let workspaceId: string;
  let blobRoot: string;

  before(async () => {
    pool = createPool();
    blobRoot = path.join(os.tmpdir(), `blob-service-test-${Date.now()}`);
    process.env.BLOB_STORAGE_ROOT = blobRoot;
    await ensureStorageDirs();
  });

  beforeEach(async () => {
    workspaceId = randomWorkspaceId();
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  });

  it('createFolder at root returns folder node', async () => {
    const node = await createFolder(client, {
      workspaceId,
      parentId: null,
      name: '  My Folder  ',
    });
    assert.strictEqual(node.kind, 'folder');
    assert.strictEqual(node.name, 'My Folder');
    assert.strictEqual(node.normalized_name, 'my folder');
    assert.strictEqual(node.depth, 0);
    assert.strictEqual(node.parent_id, null);
    assert.ok(node.full_path_cache === '/My Folder' || node.full_path_cache?.endsWith('My Folder'));
  });

  it('createFolder nested sets parent, depth, full_path_cache', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'root' });
    const nested = await createFolder(client, {
      workspaceId,
      parentId: root.id,
      name: 'nested',
    });
    assert.strictEqual(nested.parent_id, root.id);
    assert.strictEqual(nested.depth, 1);
    assert.ok(nested.full_path_cache?.includes('nested'));
  });

  it('createFolder duplicate sibling name throws ConflictError', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'root' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'same' });
    await assert.rejects(
      () => createFolder(client, { workspaceId, parentId: root.id, name: 'same' }),
      ConflictError
    );
  });

  it('createFolder with invalid parentId throws NotFoundError', async () => {
    const badId = crypto.randomUUID();
    await assert.rejects(
      () => createFolder(client, { workspaceId, parentId: badId, name: 'x' }),
      NotFoundError
    );
  });

  it('listChildren returns direct children only, folders first then by normalized_name', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'r' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'B' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'A' });
    const fileB = await createFileFromStream(client, {
      workspaceId,
      parentId: root.id,
      filename: 'b.txt',
      mimeType: 'text/plain',
      stream: Readable.from(Buffer.from('b')),
    });
    const fileA = await createFileFromStream(client, {
      workspaceId,
      parentId: root.id,
      filename: 'a.txt',
      mimeType: 'text/plain',
      stream: Readable.from(Buffer.from('a')),
    });
    const children = await listChildren(client, workspaceId, root.id);
    assert.strictEqual(children.length, 4);
    assert.strictEqual(children[0].kind, 'folder');
    assert.strictEqual(children[0].normalized_name, 'a');
    assert.strictEqual(children[1].kind, 'folder');
    assert.strictEqual(children[1].normalized_name, 'b');
    assert.strictEqual(children[2].kind, 'file');
    assert.strictEqual(children[2].normalized_name, 'a.txt');
    assert.strictEqual(children[3].kind, 'file');
    assert.strictEqual(children[3].normalized_name, 'b.txt');
  });

  it('createFileFromStream inserts blob and node; same content reuses blob and increments ref_count', async () => {
    const content = Buffer.from('identical content');
    const one = await createFileFromStream(client, {
      workspaceId,
      parentId: null,
      filename: 'first.txt',
      mimeType: 'text/plain',
      stream: Readable.from(content),
    });
    const two = await createFileFromStream(client, {
      workspaceId,
      parentId: null,
      filename: 'second.txt',
      mimeType: 'text/plain',
      stream: Readable.from(content),
    });
    assert.strictEqual(one.blob.id, two.blob.id);
    assert.strictEqual(one.node.blob_id, two.node.blob_id);
    const blobRes = await client.query(
      'SELECT ref_count FROM blobs WHERE id = $1',
      [one.blob.id]
    );
    assert.strictEqual(Number(blobRes.rows[0]?.ref_count), 2);
  });

  it('renameNode renames a file', async () => {
    const file = await createFileFromStream(client, {
      workspaceId,
      parentId: null,
      filename: 'old.txt',
      mimeType: 'text/plain',
      stream: Readable.from(Buffer.from('x')),
    });
    const updated = await renameNode(client, {
      workspaceId,
      nodeId: file.node.id,
      newName: 'new.txt',
    });
    assert.strictEqual(updated.name, 'new.txt');
    assert.strictEqual(updated.normalized_name, 'new.txt');
    assert.ok(updated.full_path_cache?.endsWith('new.txt'));
  });

  it('renameNode on folder updates descendant full_path_cache', async () => {
    const folder = await createFolder(client, { workspaceId, parentId: null, name: 'OldName' });
    const child = await createFolder(client, { workspaceId, parentId: folder.id, name: 'child' });
    const updated = await renameNode(client, {
      workspaceId,
      nodeId: folder.id,
      newName: 'NewName',
    });
    assert.strictEqual(updated.full_path_cache, '/NewName');
    const childRes = await client.query(
      'SELECT full_path_cache, depth FROM nodes WHERE id = $1',
      [child.id]
    );
    const c = childRes.rows[0] as { full_path_cache: string; depth: number };
    assert.ok(c.full_path_cache?.includes('NewName') && c.full_path_cache?.includes('child'));
    assert.strictEqual(c.depth, 1);
  });

  it('moveNode moves file to another folder', async () => {
    const target = await createFolder(client, { workspaceId, parentId: null, name: 'Target' });
    const file = await createFileFromStream(client, {
      workspaceId,
      parentId: null,
      filename: 'f.txt',
      mimeType: 'text/plain',
      stream: Readable.from(Buffer.from('x')),
    });
    const updated = await moveNode(client, {
      workspaceId,
      nodeId: file.node.id,
      newParentId: target.id,
    });
    assert.strictEqual(updated.parent_id, target.id);
    assert.strictEqual(updated.depth, 1);
    assert.ok(updated.full_path_cache?.includes('Target') && updated.full_path_cache?.includes('f.txt'));
  });

  it('moveNode moves folder and updates descendant paths and depths', async () => {
    const dest = await createFolder(client, { workspaceId, parentId: null, name: 'Dest' });
    const folder = await createFolder(client, { workspaceId, parentId: null, name: 'MoveMe' });
    const child = await createFolder(client, { workspaceId, parentId: folder.id, name: 'Child' });
    const updated = await moveNode(client, {
      workspaceId,
      nodeId: folder.id,
      newParentId: dest.id,
    });
    assert.strictEqual(updated.parent_id, dest.id);
    assert.strictEqual(updated.depth, 1);
    assert.ok(updated.full_path_cache?.includes('Dest') && updated.full_path_cache?.includes('MoveMe'));
    const childRes = await client.query(
      'SELECT full_path_cache, depth FROM nodes WHERE id = $1',
      [child.id]
    );
    const c = childRes.rows[0] as { full_path_cache: string; depth: number };
    assert.ok(c.full_path_cache?.includes('Dest') && c.full_path_cache?.includes('MoveMe') && c.full_path_cache?.includes('Child'));
    assert.strictEqual(c.depth, 2);
  });

  it('moveNode to root sets parent_id null and depth 0', async () => {
    const folder = await createFolder(client, { workspaceId, parentId: null, name: 'Parent' });
    const file = await createFileFromStream(client, {
      workspaceId,
      parentId: folder.id,
      filename: 'f.txt',
      mimeType: 'text/plain',
      stream: Readable.from(Buffer.from('x')),
    });
    const updated = await moveNode(client, {
      workspaceId,
      nodeId: file.node.id,
      newParentId: null,
    });
    assert.strictEqual(updated.parent_id, null);
    assert.strictEqual(updated.depth, 0);
  });

  it('moveNode into self throws InvalidMoveError', async () => {
    const folder = await createFolder(client, { workspaceId, parentId: null, name: 'F' });
    await assert.rejects(
      () => moveNode(client, { workspaceId, nodeId: folder.id, newParentId: folder.id }),
      InvalidMoveError
    );
  });

  it('moveNode into descendant throws InvalidMoveError', async () => {
    const folder = await createFolder(client, { workspaceId, parentId: null, name: 'Parent' });
    const child = await createFolder(client, { workspaceId, parentId: folder.id, name: 'Child' });
    await assert.rejects(
      () => moveNode(client, { workspaceId, nodeId: folder.id, newParentId: child.id }),
      InvalidMoveError
    );
  });

  it('renameNode duplicate sibling name throws ConflictError', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'root' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'existing' });
    const node = await createFolder(client, { workspaceId, parentId: root.id, name: 'other' });
    await assert.rejects(
      () => renameNode(client, { workspaceId, nodeId: node.id, newName: 'existing' }),
      ConflictError
    );
  });

  it('moveNode duplicate sibling name at target throws ConflictError', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'root' });
    const target = await createFolder(client, { workspaceId, parentId: root.id, name: 'target' });
    await createFolder(client, { workspaceId, parentId: target.id, name: 'taken' });
    const node = await createFolder(client, { workspaceId, parentId: root.id, name: 'taken' });
    await assert.rejects(
      () => moveNode(client, { workspaceId, nodeId: node.id, newParentId: target.id }),
      ConflictError
    );
  });

  it('getFileForDownload returns node and storagePath for a file', async () => {
    const file = await createFileFromStream(client, {
      workspaceId,
      parentId: null,
      filename: 'doc.txt',
      mimeType: 'text/plain',
      stream: Readable.from(Buffer.from('content')),
    });
    const out = await getFileForDownload(client, workspaceId, file.node.id);
    assert.strictEqual(out.node.name, 'doc.txt');
    assert.strictEqual(out.node.mime_type, 'text/plain');
    assert.ok(out.storagePath.length > 0);
  });

  it('getFileForDownload for folder throws NotDownloadableError', async () => {
    const folder = await createFolder(client, { workspaceId, parentId: null, name: 'F' });
    await assert.rejects(
      () => getFileForDownload(client, workspaceId, folder.id),
      NotDownloadableError
    );
  });

  it('getFileForDownload for missing node throws NotFoundError', async () => {
    const badId = crypto.randomUUID();
    await assert.rejects(
      () => getFileForDownload(client, workspaceId, badId),
      NotFoundError
    );
  });

  it('searchNodes exact normalized match ranks first', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'root' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'ExactMatch' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'exactmatch suffix' });
    const results = await searchNodes(client, workspaceId, 'exactmatch');
    assert.ok(results.length >= 2);
    assert.strictEqual(results[0].name, 'ExactMatch');
  });

  it('searchNodes prefix and path match return correct fields', async () => {
    const root = await createFolder(client, { workspaceId, parentId: null, name: 'root' });
    await createFolder(client, { workspaceId, parentId: root.id, name: 'PrefixFolder' });
    const results = await searchNodes(client, workspaceId, 'prefix');
    assert.ok(results.length >= 1);
    const first = results[0];
    assert.ok('id' in first && 'kind' in first && 'name' in first && 'full_path_cache' in first);
    assert.ok('size_bytes' in first && 'mime_type' in first && 'updated_at' in first);
  });

  it('searchNodes returns only nodes in the given workspace', async () => {
    const otherWorkspace = randomWorkspaceId();
    await createFolder(client, { workspaceId: otherWorkspace, parentId: null, name: 'secret' });
    const results = await searchNodes(client, workspaceId, 'secret');
    assert.strictEqual(results.length, 0);
  });
});
