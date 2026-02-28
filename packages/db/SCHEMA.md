# Database schema: hosted filesystem metadata

PostgreSQL. Hierarchy is **adjacency list** (`parent_id`); `full_path_cache` is a cached read optimization, not source of truth.

## Tables

### blobs

Content-addressable blob metadata. Actual bytes live in object storage; this table tracks identity and reference count for GC.

| Column        | Type        | Description |
|---------------|-------------|-------------|
| id            | uuid        | PK |
| sha256        | char(64)    | Hex digest; UNIQUE |
| storage_path  | text        | Path in storage (e.g. prefix/sha256) |
| size_bytes    | bigint      | Blob size |
| ref_count     | integer     | Number of file nodes referencing this blob; default 0 |
| created_at    | timestamptz | |

### nodes

File and folder nodes per workspace. Tree structure via `parent_id`; `parent_id` NULL = root.

| Column          | Type        | Description |
|-----------------|-------------|-------------|
| id              | uuid        | PK |
| workspace_id    | uuid        | Scope (no FK; app-owned) |
| parent_id       | uuid        | FK → nodes(id); NULL = root |
| kind            | text        | `'file'` or `'folder'` |
| name            | text        | Display name |
| normalized_name | text        | For uniqueness (e.g. lowercased) |
| full_path_cache | text        | Cached path; maintained by app |
| depth           | integer     | 0 = root |
| blob_id         | uuid        | FK → blobs(id); NULL for folders |
| size_bytes      | bigint      | NULL for folders |
| mime_type       | text        | For files |
| created_at      | timestamptz | |
| updated_at      | timestamptz | |

## DB-enforced invariants

- **Sibling names unique**: Enforced by two partial unique indexes (see below). A single `UNIQUE(workspace_id, parent_id, normalized_name)` would **not** prevent duplicate root-level names: in PostgreSQL (and standard SQL), `NULL` is distinct in unique constraints, so all rows with `parent_id IS NULL` would be considered different and multiple roots with the same `normalized_name` would be allowed. Splitting into two indexes—one for non-roots on `(workspace_id, parent_id, normalized_name)` and one for roots on `(workspace_id, normalized_name)`—correctly enforces uniqueness in both cases.
- **blob sha256**: UNIQUE on `blobs.sha256`.
- **Kind**: `CHECK (kind IN ('file', 'folder'))`.
- **Folders don’t reference blobs**: `CHECK (kind <> 'folder' OR blob_id IS NULL)`.
- **Referential integrity**: `parent_id` → nodes(id) ON DELETE RESTRICT; `blob_id` → blobs(id) ON DELETE RESTRICT.

## Indexes

- **blobs**: UNIQUE on `sha256` (index for lookups).
- **nodes**: `(workspace_id, parent_id)` — list children; `(workspace_id, full_path_cache)` — path lookup; `(workspace_id)` — workspace scope.

**Sibling name uniqueness (two partial unique indexes):**

| Scope   | Index columns                              | Condition           |
|---------|--------------------------------------------|---------------------|
| Non-root| `(workspace_id, parent_id, normalized_name)` | `parent_id IS NOT NULL` |
| Root    | `(workspace_id, normalized_name)`           | `parent_id IS NULL` |

Together these guarantee exactly one node per normalized name per parent (and per workspace). No single `UNIQUE` can do both, because `NULL` in `parent_id` does not participate in uniqueness.

**Search (migration 003):** `(workspace_id, normalized_name)` for exact/prefix match; `pg_trgm` extension with GIN on `name` and `full_path_cache` for ILIKE substring search.

## Application-layer responsibilities

These are **not** enforced by the DB; the app must maintain them:

- **full_path_cache**: Update on rename/move.
- **depth**: Update when creating or moving nodes.
- **ref_count**: Increment when a file links to a blob; decrement when a file is deleted or unlinked.
- **updated_at**: Set on every node update.

## Running migrations

**Option 1 — psql (inspect and run SQL directly):**

```bash
psql "$DATABASE_URL" -f packages/db/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f packages/db/migrations/002_seed_example.sql  # optional
```

Or from repo root:

```bash
cd packages/db && for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

**Option 2 — Node runner (after building the package):**

```bash
cd packages/db && pnpm build && DATABASE_URL="..." pnpm run migrate
```

**Stress/benchmark (after migrations):** Seeds 300 files in one folder, 50 nested folders, then times list, search, and move. Run: `cd packages/db && DATABASE_URL="..." pnpm run stress`.
