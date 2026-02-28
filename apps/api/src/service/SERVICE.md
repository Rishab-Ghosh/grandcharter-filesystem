# Service layer: metadata + blob storage

- **createFolder**: Single INSERT; unique violation (23505) → ConflictError.
- **createFileFromStream**: Blob is written to disk first (outside transaction). Then one DB transaction: single upsert on `blobs` (INSERT ... ON CONFLICT (sha256) DO UPDATE SET ref_count = blobs.ref_count + 1 RETURNING *), then INSERT file node. Caller must pass a PoolClient with BEGIN already called; on success COMMIT, on failure ROLLBACK. The upsert is race-safe under concurrent identical uploads.
- **getFileForDownload**: Single query with LEFT JOIN blobs; one round-trip. Not found vs folder distinguished by row presence and kind/storage_path.
- **searchNodes**: Uses workspace_id + (normalized_name exact/prefix or pg_trgm ILIKE on name/full_path_cache). Result set capped at 500 rows to avoid unbounded response size.

## If blob write succeeds but DB transaction fails

The blob file remains on disk; no blob row or node row is committed (transaction rolled back). That leaves an **orphan blob file**. The app does not delete it in this path. A later GC job can remove blob files that have no corresponding row in `blobs`, or that have `ref_count = 0` and are older than a threshold.
