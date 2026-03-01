import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import type { Readable } from 'node:stream';

function getRoot(): string {
  const root = process.env['BLOB_STORAGE_ROOT'];
  if (!root) throw new Error('BLOB_STORAGE_ROOT is not set');
  return path.resolve(root);
}

export function getBlobPathForHash(sha256: string): string {
  if (sha256.length < 4) throw new Error('sha256 must be at least 4 hex chars');
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

export async function ensureStorageDirs(): Promise<string> {
  const root = getRoot();
  await mkdir(path.join(root, 'blobs'), { recursive: true });
  await mkdir(path.join(root, 'tmp'), { recursive: true });
  return root;
}

export function openBlobReadStream(storagePath: string): ReturnType<typeof createReadStream> {
  const root = getRoot();
  const full = path.join(root, 'blobs', storagePath);
  return createReadStream(full);
}

export async function writeIncomingStreamToBlob(
  stream: Readable
): Promise<{ sha256: string; sizeBytes: number; storagePath: string; deduped: boolean }> {
  const root = getRoot();
  const tmpDir = path.join(root, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `blob-${randomBytes(16).toString('hex')}`);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const fileStream = createWriteStream(tmpPath);
  fileStream.on('error', (err) => stream.destroy(err));

  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      sizeBytes += (chunk as Buffer).length;
      const ok = fileStream.write(chunk);
      if (!ok) await once(fileStream, 'drain');
    }
    fileStream.end();
    await once(fileStream, 'finish');
  } catch (err) {
    fileStream.destroy();
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  const sha256 = hash.digest('hex');
  const storagePath = getBlobPathForHash(sha256);
  const blobFullPath = path.join(root, 'blobs', storagePath);
  await mkdir(path.dirname(blobFullPath), { recursive: true });

  let exists = false;
  try {
    await access(blobFullPath);
    exists = true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  if (exists) {
    await unlink(tmpPath);
    return { sha256, sizeBytes, storagePath, deduped: true };
  }
  await rename(tmpPath, blobFullPath);
  return { sha256, sizeBytes, storagePath, deduped: false };
}
