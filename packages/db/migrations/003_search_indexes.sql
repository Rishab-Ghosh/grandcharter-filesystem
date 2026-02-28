-- Search support: exact/prefix on normalized_name, and trigram for ILIKE on name/full_path_cache.
-- pg_trgm enables GIN indexes for substring search; planner can combine with workspace_id filter.

CREATE INDEX IF NOT EXISTS idx_nodes_workspace_normalized ON nodes (workspace_id, normalized_name);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_nodes_name_trgm ON nodes USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nodes_full_path_trgm ON nodes USING gin (full_path_cache gin_trgm_ops);
