import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ensureStorageDirs,
  getBlobPathForHash,
  openBlobReadStream,
  writeIncomingStreamToBlob,
} from './index.js';

function useTempRoot(): string {
  const root = path.join(os.tmpdir(), `blob-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.BLOB_STORAGE_ROOT = root;
  return root;
}

async function readStreamToBuffer(stream: ReturnType<typeof openBlobReadStream>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('blob storage', () => {
  it('getBlobPathForHash returns 2/2/full path', () => {
    const p = getBlobPathForHash('abcdef0123456789'.padEnd(64, '0'));
    assert.strictEqual(p, 'ab/cd/abcdef012345678900000000000000000000000000000000000000000000');
  });

  it('writeIncomingStreamToBlob writes blob and returns sha256, sizeBytes, storagePath, deduped false', async () => {
    const root = useTempRoot();
    await ensureStorageDirs();
    const body = Buffer.from('hello world');
    const stream = Readable.from(body);
    const out = await writeIncomingStreamToBlob(stream);
    assert.strictEqual(out.sizeBytes, 11);
    assert.strictEqual(out.deduped, false);
    assert.match(out.sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(out.storagePath, getBlobPathForHash(out.sha256));
    const expectedHash = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    assert.strictEqual(out.sha256, expectedHash);
  });

  it('writing same content again returns deduped true and does not create duplicate file', async () => {
    const root = useTempRoot();
    await ensureStorageDirs();
    const body = Buffer.from('same content');
    const out1 = await writeIncomingStreamToBlob(Readable.from(body));
    const out2 = await writeIncomingStreamToBlob(Readable.from(body));
    assert.strictEqual(out1.sha256, out2.sha256);
    assert.strictEqual(out2.deduped, true);
    assert.strictEqual(out2.sizeBytes, body.length);
  });

  it('openBlobReadStream returns readable stream with blob content', async () => {
    const root = useTempRoot();
    await ensureStorageDirs();
    const body = Buffer.from('read me');
    const { storagePath } = await writeIncomingStreamToBlob(Readable.from(body));
    const stream = openBlobReadStream(storagePath);
    const read = await readStreamToBuffer(stream);
    assert.deepStrictEqual(read, body);
  });

  it('stream error cleans up temp file', async () => {
    const root = useTempRoot();
    await ensureStorageDirs();
    const failingStream = new Readable({
      read() {
        this.push(Buffer.from('one chunk'));
        this.destroy(new Error('stream failed'));
      },
    });
    await assert.rejects(() => writeIncomingStreamToBlob(failingStream), /stream failed/);
    const tmpDir = path.join(root, 'tmp');
    const entries = await readdir(tmpDir);
    assert.strictEqual(entries.length, 0, 'tmp dir should be empty after failed write');
  });
});
