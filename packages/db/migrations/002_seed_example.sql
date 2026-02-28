-- Example seed: one workspace with root folder, nested folder, and one file.
-- Run only after 001_initial_schema.sql. Replace workspace and blob IDs for real use.

-- Example blob (content-addressable)
INSERT INTO blobs (id, sha256, storage_path, size_bytes, ref_count)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'e3/b0/c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  0,
  1
);

-- Workspace root (single root folder per workspace in this example)
INSERT INTO nodes (id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  NULL,
  'folder',
  '',
  '',
  '/',
  0,
  NULL,
  NULL,
  NULL
);

-- Nested folder
INSERT INTO nodes (id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type)
VALUES (
  'b0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'folder',
  'Documents',
  'documents',
  '/Documents',
  1,
  NULL,
  NULL,
  NULL
);

-- File referencing the blob
INSERT INTO nodes (id, workspace_id, parent_id, kind, name, normalized_name, full_path_cache, depth, blob_id, size_bytes, mime_type)
VALUES (
  'b0000000-0000-4000-8000-000000000003',
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002',
  'file',
  'readme.txt',
  'readme.txt',
  '/Documents/readme.txt',
  2,
  'a0000000-0000-4000-8000-000000000001',
  0,
  'text/plain'
);
