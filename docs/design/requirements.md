# FileShed — Requirements & Technical Design

FileShed (`fileshed` internally — repo, package, binary) is self-hosted, multi-user file hosting with a Google Drive-class UX. This document is the source of truth for v1 scope and the technical decisions behind it.

---

## 1. Goals

- Multi-user file hosting: nested folders, sharing, a UI that doesn't suck.
- Direct links: both forced-download and hotlinkable inline URLs (image/video hosting).
- Shared items are first-class: recipients place shared files/folders anywhere in their own tree — no "Shared with me" ghetto.
- True shared folders: multiple users can add files and create subfolders inside a folder shared with them as editors.
- Content-addressed storage with SHA-256 deduplication.
- Pluggable storage backends: filesystem, database blob, S3-compatible, Azure Blob.
- Optional per-user storage quotas, charged by **file ownership**, never folder ownership.

### Non-goals (v1)

- Document/spreadsheet editing (future cherry on top; nothing in the data model should preclude it).
- Resumable/chunked uploads (tus). v1 is streaming multipart. Design the upload endpoint so tus can be added without breaking clients.
- Cross-instance federation, WebDAV, desktop sync clients.
- Full-text content search. v1 search is name/metadata only.

---

## 2. Tech Stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Language/runtime | TypeScript / Node.js | |
| Frontend | Vue 3 + Nuxt UI v4 (standalone via Vite plugin) + Tailwind CSS | Nuxt UI v4 is MIT, includes former Pro components. **Not** using Nuxt the framework — plain Vue + Vite. |
| Auth | BetterAuth | Email/password v1; OAuth providers are config, not code. |
| DB access | Kysely | One schema-agnostic query builder across both dialects. |
| Database | **Postgres (primary target)**, SQLite (supported convenience deployment) | Deployment-time choice. Feature parity required, but when a tradeoff appears, Postgres wins and SQLite gets the workaround. |
| Client-side hashing | hash-wasm | Incremental SHA-256 over `File.stream()`. Do NOT use `crypto.subtle.digest` (requires whole file in memory). |
| Migrations | Kysely migrations, hand-written, dialect-aware where necessary | |

Domain modeling convention: canonical TypeScript domain types with Zod codecs at the boundaries (DB rows ⇄ domain, API DTOs ⇄ domain). Tables serve the domain types, not vice versa.

---

## 3. Data Model

All primary keys are **cuid2** strings, generated app-side. cuid2 is deliberately non-monotonic — order by `created_at`, never by id.

### 3.1 Core entities

- **user** — BetterAuth-managed identity plus app profile (quota limit, role: admin/user).
- **node** — a file, folder, or link. Fields: `id`, `type` (file|folder|link), `name`, `owner_id`, `parent_id` (nullable = root level), `blob_id` (files only), `target_node_id` (links only), `size` (logical, files only), `mime_type`, `created_at`, `updated_at`, `trashed_at` (nullable).
  - A **link** is the recipient-side placement of a shared item: an ordinary node, owned by the recipient, living in their tree, pointing at someone else's node. Links may not target links. Links carry no size, no quota charge, and no ACL of their own.
- **share** — a permission grant. Fields: `id`, `node_id`, `grantee_user_id`, `role` (viewer|editor), `created_by`, `created_at`.
- **public_link** — tokened anonymous access to a node. Fields: `id`, `node_id`, `token`, `mode` (view|download), `disposition` (inline|attachment), `created_at`, `revoked_at`.
- **blob** — content-addressed storage record. Fields: `sha256` (PK), `size`, `backend_id`, `storage_key`, `created_at`, `deleted_at` (nullable, GC grace marker).
- **storage_backend** — configured backend instances: `id`, `kind` (fs|db|s3|azure), config JSON, `is_default`.

### 3.2 Trees: per-user, with links

There is no global tree. Each user has an implicit root (their "My Drive"). Shared items enter a user's tree as **link nodes** (§3.1) — ordinary nodes the recipient moves, renames, and deletes with the same code paths as everything else. Listing children is a single query over nodes; links resolve their target for display (name defaults to the target's current name unless renamed; UI shows a link badge + owner).

Parent-edge rule: `parent_id` points to a folder owned by the same user, **except** nodes created inside a folder shared to the creator as editor (§3.3) — the one sanctioned cross-owner edge.

Link behavior:

- Deleting a link removes the item from your tree only. The target node and the share are untouched. (UI: "Remove from my drive.")
- Moving/renaming a link changes nothing for the owner or other recipients.
- Creating a link requires an active share on (or ownership of) the target. Links may not target links.
- When a share is revoked or left, the recipient's links to that target (and to anything inside its subtree) are dead; a cleanup pass deletes them and the UI treats dead links as absent in the meantime.
- Inside a linked folder, the recipient sees the owner's subtree as-is. Recipients do not re-arrange the interior of someone else's folder except via editor permissions (real moves, visible to everyone).
- Cycle prevention applies to real parent edges only; links don't participate in ownership traversal and cannot create true cycles.

### 3.2a Access vs placement

Shares grant access; links are placement. Independent lifecycles:

- A new share does **not** auto-create a link. It appears in the recipient's **Shared with me** view — a virtual listing (query over the recipient's active shares), not a folder. Every item there offers "Add to my drive" (creates a link in a folder of your choosing); placed items show where they live.
- Deleting your link does not revoke access — the item remains in Shared with me, re-placeable anytime.
- Ending access is explicit: the owner revokes the share, or the recipient **leaves** it (deletes the grant and their links).

### 3.3 True shared folders

When a user with `editor` on a folder creates a file/subfolder inside it:

- The new node's **owner is the creator** (quota charges the creator).
- Its `parent_id` points into the folder owner's subtree — this is the one sanctioned exception to the same-owner parent rule. Mark it: node has `owner_id` ≠ parent's `owner_id`. All permission checks resolve through the *shared folder's* ACL, and the item travels with the folder.
- If the folder owner revokes the creator's access later, the creator's items remain in the folder (they contributed them) but the creator loses access like anyone else. Their quota is still charged until the file is deleted. Admin tooling should surface "files you own in folders you can't access."

### 3.4 Permissions

- Roles: `viewer` (read/download), `editor` (viewer + upload, create, rename, move within the shared subtree, trash items they own), `owner` (everything, including sharing and permanent delete).
- Inheritance: a share on a folder applies to its entire subtree. Effective role for a user on a node = max(direct shares, inherited shares, ownership).
- Shares can only be created by the node's owner (v1; "editors can re-share" is a future toggle).
- Link nodes carry no permissions; every check resolves against the target node's ACL. A dead link (share revoked) resolves to no access.
- Permission resolution must be a single indexed query or cheap recursive CTE — it runs on every request. Both Postgres and SQLite support recursive CTEs; write it once in Kysely.

---

## 4. Storage: Content-Addressed Blobs

### 4.1 Blob store interface

Every backend implements exactly this:

```ts
interface BlobStore {
  exists(sha256: string): Promise<boolean>
  put(sha256: string, stream: Readable, size: number): Promise<void>   // must verify hash while writing; reject mismatch
  getStream(sha256: string, range?: { offset: number; length: number }): Promise<Readable>
  read(sha256: string, offset: number, length: number): Promise<Buffer> // for PoP challenges
  delete(sha256: string): Promise<void>
}
```

Backends: `fs` (sharded dirs by hash prefix, e.g. `ab/cd/abcd…`), `db` (blob column; use ranged reads — Postgres `substr` on bytea / SQLite incremental blob I/O — never load whole blobs), `s3` (ranged GET native), `azure` (ranged GET native).

Notes:

- Ranged reads serve double duty: HTTP `Range` requests on direct links and proof-of-possession challenges.
- One default backend per deployment; multiple configured backends supported (blob records pin their backend). Migration between backends is admin tooling, out of v1 scope but the schema supports it.

### 4.2 Deduplication & ref-counting

- `blob.sha256` is the identity. A blob is stored once regardless of how many nodes reference it.
- Ref count is derived (count of non-purged file nodes referencing the blob), not a stored counter — avoids drift. Index `node.blob_id`.
- When the last reference is removed, set `blob.deleted_at` (graveyard). A scheduled GC job hard-deletes blobs whose `deleted_at` exceeds the grace window (default 7 days, configurable).
- A successful claim of a graveyard blob clears `deleted_at` (resurrection). Claim/GC must be concurrency-safe: GC takes a per-blob lock or uses `DELETE … WHERE deleted_at < cutoff` with the claim path clearing `deleted_at` first, in a transaction.

### 4.3 Upload flow

**Small files (< 1 MiB): plain upload, no claim dance.** Round trips cost more than the bytes.

**Larger files:**

1. Client computes SHA-256 incrementally (hash-wasm over `File.stream()`).
2. `POST /api/blobs/claim { sha256, size }`
3. Server:
   - Blob unknown → respond `{ upload: true, ticket }`. Client streams the file (`PUT /api/uploads/:ticket`). Server hashes while streaming to temp staging, verifies against the claimed hash (reject mismatch — a lying client must not poison the store), then commits: move to backend, insert/resurrect blob, create node.
   - Blob known (including graveyarded) → **proof-of-possession challenge**: respond `{ challenge_id, nonce, ranges: [[offset, length], …] }` — 2–4 ranges, random offsets and lengths, single-use, TTL 60s.
4. Client answers: `File.slice()` each range, compute `HMAC-SHA256(nonce, range₀ ‖ range₁ ‖ …)`, `POST /api/blobs/claim/:challenge_id`.
5. Server reads the same ranges via `BlobStore.read`, verifies the HMAC, then (in one transaction) resurrects if graveyarded, creates the node. Zero bytes uploaded.

Security requirements:

- Ranges MUST be random per challenge (fixed ranges are harvest-and-replay-able). Nonce-keyed HMAC prevents replay across challenges.
- Failed challenges are logged with user id and rate-limited per user (a failed proof = someone probing hashes they don't possess).
- Challenges are single-use and expire; unanswered challenges are just dropped.

### 4.4 Trash & delete semantics

- Trashing a node sets `trashed_at`; subtree is hidden from normal listings, visible in Trash. **Trashed files still count against the owner's quota** (matches Drive; prevents trash-as-free-storage).
- Restore clears `trashed_at`; if the original parent is gone, restore to owner's root.
- Permanent delete (manual or auto-purge after 30 days, configurable) removes the node; blob ref-counting handles the rest.
- Trashing a shared folder (by owner) hides it from all recipients. Recipients cannot trash nodes they don't own — they delete their link instead. Links are deleted directly, never trashed (they're re-creatable from Shared with me).

---

## 5. Quotas

- Optional per-user byte limit (null = unlimited). Admin-settable default + per-user override.
- Charged usage = Σ logical `size` of file nodes **owned** by the user, excluding purged, **including trashed**.
- Dedup is invisible to quotas: if two users own nodes referencing the same 4 GB blob, each is charged 4 GB. One user deleting their node stops their charge; the other's is unaffected.
- Enforcement at claim/upload time: reject if `used + size > limit` with a clear error. Usage is a cheap aggregate query; cache per-user with invalidation on node create/delete/purge if it shows up in profiles.

---

## 6. Direct Links

- Public links reference the **file node**, not the content hash — the URL survives content changes (future versioning) and dies with the node.
- URL shape: `/d/:token` — server resolves token → node → blob and streams.
- `disposition` per link: `inline` (hotlinking: correct `Content-Type`, no `Content-Disposition: attachment`) or `attachment` (forced download).
- MUST support: HTTP `Range` requests (byte ranges, single range sufficient), `ETag` (the blob sha256 is the natural etag), `If-None-Match`, `Accept-Ranges`, correct `Content-Length`.
- Links are revocable; multiple links per node allowed (e.g., one inline, one download).
- No auth on `/d/:token` by design. Token entropy ≥ 128 bits.
- Optional per-link toggles deferred to post-v1: expiry, password, download counting.

---

## 7. API

REST, JSON, cookie session auth (BetterAuth). Sketch — exact DTOs defined in code with Zod:

- `GET /api/nodes/:id` · `GET /api/nodes/:id/children` (owned nodes and mounts interleaved, paginated, sortable)
- `POST /api/nodes` (create folder) · `PATCH /api/nodes/:id` (rename/move) · `POST /api/nodes/:id/trash` · `/restore` · `DELETE /api/nodes/:id` (permanent)
- `POST /api/blobs/claim` · `POST /api/blobs/claim/:challengeId` · `PUT /api/uploads/:ticket`
- `GET /api/nodes/:id/download` (authed download, same Range/ETag behavior as public links)
- `POST /api/nodes/:id/shares` · `DELETE /api/shares/:id` · `GET /api/nodes/:id/shares`
- `POST /api/nodes/:id/links` · `DELETE /api/links/:id`
- Links are plain node CRUD: `POST /api/nodes` with `type: link` + `target_node_id`; move/rename/delete via the node endpoints
- `GET /api/shared-with-me` (active shares + placement status) · `POST /api/shares/:id/leave`
- `GET /api/search?q=` (name match, scoped to accessible nodes)
- `GET /api/me` (profile, quota used/limit) · admin: user CRUD, quota management, backend status, GC status

All node-returning endpoints include the caller's effective role on each item.

---

## 8. Frontend

Drive-class UX. Nuxt UI v4 provides the chrome (dialogs, menus, toasts, forms, tables); the core file-management surface is custom:

- **Main view**: grid and list modes, sortable columns (name, size, modified, owner), breadcrumb path, folder tree sidebar.
- **Selection**: click, ctrl/shift-click, marquee (drag-select). Keyboard: arrows, enter to open, del to trash, F2 rename.
- **Drag & drop**: move within tree (including drop on sidebar folders), drop-from-OS to upload (files and folders via webkitdirectory/DataTransferItem traversal).
- **Context menus** on nodes and empty space: open, download, share, get link, rename, move, remove from my drive, trash — filtered by effective role.
- **Upload manager**: bottom-right panel, per-file progress, hash-then-claim phase shown ("checking…" → instant complete on dedup hit), cancel, error retry.
- **Share dialog**: user picker, role select, current grants list, public link management (create inline/download links, copy, revoke).
- **Shared-item affordances**: shared objects must be immediately identifiable at a glance — link badge + owner on links, "shared" indicator on nodes you own that have grants. "Leave share" is a standard action on any shared-with-you object (context menu on the link *and* in Shared with me). "Remove from my drive" (delete link) triggers a prompt offering to also leave the share — deleting the placement without surfacing that option leaves the item haunting Shared with me, which users will file as a bug. "Trash" applies to owned nodes only.
- **Shared with me view**: virtual listing of active shares with placement status and "Add to my drive".
- **Trash view**, **quota meter** in sidebar, name search in header.
- Image/video/audio/PDF preview via browser-native rendering against the download endpoint (Range support makes video scrubbing work). No bespoke viewers in v1.

---

## 9. Deployment

- Single Docker image (server serves API + built SPA). `docker-compose` examples for: SQLite + fs backend (minimal), Postgres + S3 (full).
- Configuration via env vars: DB kind + connection, backend config, base URL, quota defaults, GC grace window, trash purge window, upload size limit.
- First-run bootstrap: create admin user via env or CLI.
- Health endpoint; structured logging.

---

## 10. Build Order (suggested)

1. Schema + Kysely setup (both dialects), domain types, BetterAuth integration.
2. Blob store interface + fs backend; upload/claim/PoP flow; GC job.
3. Nodes CRUD, per-user tree, trash, quotas.
4. Shares, mounts, permission resolution.
5. Direct links with Range/ETag.
6. Frontend shell → main view → uploads → sharing → trash/search.
7. Remaining backends (db, S3, Azure) against the BlobStore contract + its test suite.

## 11. Future Work (explicitly deferred)

Resumable uploads (tus), file versioning, editor re-sharing, link expiry/passwords, full-text search, docs/sheets editing, backend-to-backend blob migration tooling, WebDAV.
