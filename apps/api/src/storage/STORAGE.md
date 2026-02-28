# Blob storage (local disk)

Content-addressed blob store keyed by SHA-256. No S3; Node fs only.

## Layout

- `BLOB_STORAGE_ROOT` (env) = root directory; must be set.
- `{root}/blobs/{aa}/{bb}/{sha256}` — final blob files. First 2 + next 2 hex chars of hash as subdirs to avoid one huge directory.
- `{root}/tmp/blob-{random}` — temporary file while streaming. Deleted on success (after rename or dedup) or on stream error.

## Failure handling

- **Stream error or throw during write:** Write stream is destroyed, temp file is unlinked, error is rethrown. No partial blob is left on disk.
- **Dedup:** After the stream finishes we have sha256. We check if the blob path already exists. If it exists we unlink the temp file and return `deduped: true`. If not we rename temp → blob path. `rename` is atomic on the same filesystem; tmp lives under root so we never cross devices.
- **Rename fails (e.g. disk full):** Temp file remains; caller gets the exception. Application layer may retry or clean up tmp later.

## Application layer

- This module does not touch the DB. Upload handlers will call `writeIncomingStreamToBlob(stream)`, then insert/update the `blobs` table and `nodes` with `blob_id` and `storage_path`. Ref-count and metadata are the app’s responsibility.
- `openBlobReadStream(storagePath)` takes the path stored in `blobs.storage_path` (same as returned from write). If the file is missing the read stream will emit an error.
