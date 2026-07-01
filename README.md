# Hosted filesystem

Take-home: a minimal hosted filesystem with workspace-scoped folders/files, content-addressed blob storage, and a file-explorer UI.

---

## 1. Project overview

- **Backend:** Fastify + TypeScript API; PostgreSQL for metadata; local disk for blob bytes.
- **Frontend:** Next.js + TypeScript; single explorer page (list, breadcrumbs, toolbar, search).
- **Monorepo:** pnpm workspaces; `apps/api`, `apps/web`, `packages/db`, `packages/shared`.
- **Scope:** Create folder, upload file, rename, move, download, search. No auth, no delete in this implementation.

---

## 2. Core features

- **Listing:** Root-level or children of a folder; `GET /api/workspaces/:workspaceId/nodes?parentId=`. Order: folders first, then by normalized name.
- **Create folder:** `POST /api/folders` (workspaceId, parentId?, name). Name normalized (trim, collapse spaces, NFC, lowercase) for uniqueness.
- **Upload file:** `POST /api/files/upload` (multipart: file + workspaceId, parentId?). Streams to disk; content-addressed by SHA-256; dedup by hash; blob row upsert + node insert in one transaction.
- **Rename:** `PATCH /api/nodes/:id/rename`. Folder renames update descendant `full_path_cache` via recursive CTE; depth unchanged.
- **Move:** `POST /api/nodes/:id/move`. Validates not into self or descendant; sibling uniqueness at target; subtree path and depth updated in one transaction.
- **Download:** `GET /api/nodes/:id/download?workspaceId=`. Streams blob from disk; Content-Type and Content-Disposition set from node metadata.
- **Search:** `GET /api/search?workspaceId=&q=`. Workspace-scoped; matches normalized name (exact/prefix) and ILIKE on name/full_path_cache; ranked; capped at 500 rows.

---

## 3. Architecture

| Layer | Stack |
|-------|--------|
| API | Fastify, @fastify/cors, @fastify/multipart; raw SQL via `pg` pool. |
| DB | PostgreSQL; migrations as SQL files in `packages/db/migrations/`. |
| Blob storage | Node `fs`; stream-in, SHA-256 on the fly; temp file then atomic rename or dedup. |
| Web | Next.js 14 (App Router); single client component for explorer; fetch to API. |

- No ORM; no repository abstraction; SQL and storage logic stay visible in the service layer.
- API and web run separately (API port 3001, web 3000); web uses `NEXT_PUBLIC_API_URL` (default `http://localhost:3001/api`).

---

## 4. Data model

- **blobs:** id, sha256 (unique), storage_path, size_bytes, ref_count, created_at. Bytes live on disk under `BLOB_STORAGE_ROOT/blobs/{aa}/{bb}/{sha256}`.
- **nodes:** id, workspace_id, parent_id (null = root), kind (file | folder), name, normalized_name, full_path_cache, depth, blob_id (null for folders), size_bytes, mime_type, created_at, updated_at.
- **Hierarchy:** Adjacency list (`parent_id`). `full_path_cache` and `depth` are maintained by the app on create/rename/move; they are not source of truth.

---

## 5. Key invariants

**DB-enforced:**

- Sibling names unique per parent per workspace: two partial unique indexes (roots: `workspace_id, normalized_name` where `parent_id IS NULL`; non-roots: `workspace_id, parent_id, normalized_name` where `parent_id IS NOT NULL`), because a single UNIQUE with nullable `parent_id` would not constrain roots in PostgreSQL.
- Blob sha256 unique; kind in ('file','folder'); folders must have blob_id NULL; FKs with ON DELETE RESTRICT.

**App-maintained:**

- full_path_cache and depth on create/rename/move; ref_count when linking/unlinking files to blobs; updated_at on node updates.

---

## 6. Search and storage design

**Search:** One query: filter by workspace_id; match normalized_name (exact or prefix) or ILIKE on name/full_path_cache (with ESCAPE for % and _). Order: exact normalized, then prefix normalized, then rest; then full_path_cache. Indexes: `(workspace_id, normalized_name)`; pg_trgm GIN on name and full_path_cache for ILIKE. LIMIT 500.

**Storage:** Stream upload to temp file; hash and size during write; then either dedup (blob path exists → unlink temp) or rename temp to final path. Download: open read stream from `blobs/{storagePath}` and pipe to response. No whole-file buffering in memory.

---

## 7. Performance considerations

- List children: indexed by (workspace_id, parent_id).
- Download: one query (nodes LEFT JOIN blobs) then stream; no second round-trip for “folder vs not found”.
- Move: single parent fetch reused for validation and path/depth; subtree update in one UPDATE with recursive CTE.
- Upload: blob upsert is INSERT … ON CONFLICT (sha256) DO UPDATE ref_count RETURNING; race-safe for concurrent identical uploads.
- Search: bounded by LIMIT 500; trigram indexes used when planner chooses.
- UI: 300ms debounce on search; no virtualisation for large lists (intentionally left for later if needed).

---

## 8. Tradeoffs / intentionally out of scope

- **Path as source of truth:** Hierarchy is parent_id; path is cached. Rename/move update cache in one transactional pass.
- **Orphan blobs:** If blob write succeeds but DB transaction fails, the file on disk is left; no automatic GC in this codebase.
- **No delete:** Node/blob delete and ref_count decrement not implemented.
- **No auth:** workspace_id is passed by client; no permissions or multi-tenant isolation.
- **Single-folder upload:** “Upload folder” (webkitdirectory) flattens to current folder; no nested path creation.
- **Search pagination:** Limit-only; no cursor or offset API.
- **Closure table / triggers:** Not used; adjacency list + app-maintained path/depth and recursive CTEs for subtree updates.

---

## 9. Running locally

**Prerequisites:** Node ≥20, pnpm, PostgreSQL.

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL, BLOB_STORAGE_ROOT (e.g. ./data/blobs). Optionally NEXT_PUBLIC_API_URL, NEXT_PUBLIC_WORKSPACE_ID.
```

**Migrations:**

```bash
cd packages/db && for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
# or: pnpm build && DATABASE_URL="..." pnpm run migrate
```

**Optional seed:** `psql "$DATABASE_URL" -f packages/db/migrations/002_seed_example.sql` (one workspace, root folder, nested folder, one file).

**Run:**

| Command | Description |
|--------|-------------|
| `pnpm dev` | API (3001) + web (3000) in parallel |
| `pnpm dev:api` | API only |
| `pnpm dev:web` | Next.js only |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | ESLint across repo |
| `pnpm format` | Prettier |

Default workspace id for the web app is in seed example or set `NEXT_PUBLIC_WORKSPACE_ID`.

---

## 10. Testing / stress testing

- **Unit/integration (API):** `pnpm --filter api test`. Requires `DATABASE_URL` and `BLOB_STORAGE_ROOT`. Runs storage tests (blob write, dedup, read stream, temp cleanup) and filesystem service tests (createFolder, createFileFromStream, listChildren, rename, move, getFileForDownload, searchNodes) in transactions with rollback.
- **Stress/benchmark:** After migrations, from `packages/db`: `DATABASE_URL="..." pnpm run stress`. Seeds 300 files in one folder and 50 nested folders (new workspace/root/blob per run), then times listChildren x5, search x5, and one move-subtree. No blob storage required for the script (reuses one blob row).
