-- Hosted filesystem metadata: blobs (content-addressable) and nodes (adjacency-list hierarchy).
-- Hierarchy source of truth: parent_id. full_path_cache is a read optimization only.

-- Blobs: content-addressable storage; ref_count for GC.
CREATE TABLE blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 char(64) NOT NULL UNIQUE,
  storage_path text NOT NULL,
  size_bytes bigint NOT NULL,
  ref_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nodes: file/folder tree per workspace; parent_id = null means root.
CREATE TABLE nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  parent_id uuid REFERENCES nodes (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('file', 'folder')),
  name text NOT NULL,
  normalized_name text NOT NULL,
  full_path_cache text,
  depth integer NOT NULL,
  blob_id uuid REFERENCES blobs (id) ON DELETE RESTRICT,
  size_bytes bigint,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folders_no_blob CHECK (kind <> 'folder' OR blob_id IS NULL)
);

-- Sibling name uniqueness: one normalized name per parent per workspace.
-- A single UNIQUE(workspace_id, parent_id, normalized_name) would not enforce uniqueness for roots:
-- in SQL, NULL <> NULL, so rows with parent_id IS NULL would not conflict. Use two partial indexes.
CREATE UNIQUE INDEX idx_nodes_sibling_unique ON nodes (workspace_id, parent_id, normalized_name)
  WHERE parent_id IS NOT NULL;

CREATE UNIQUE INDEX idx_nodes_root_name_unique ON nodes (workspace_id, normalized_name)
  WHERE parent_id IS NULL;

-- Listing children by parent (workspace-scoped).
CREATE INDEX idx_nodes_parent ON nodes (workspace_id, parent_id);

-- Lookup by path cache and workspace-scoped queries.
CREATE INDEX idx_nodes_full_path ON nodes (workspace_id, full_path_cache);
CREATE INDEX idx_nodes_workspace ON nodes (workspace_id);
