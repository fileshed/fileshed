# FileShed — Requirements & Technical Design

FileShed (`fileshed` internally — repo, package, binary) is self-hosted, multi-user file hosting whose UX holds the bar set by the mainstream cloud file managers. This document is the source of truth for v1 scope and the technical decisions behind it.

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

Domain modeling convention: canonical TypeScript domain types with Zod codecs at the boundaries (DB rows ⇄ domain, API DTOs ⇄ domain). Tables serve the domain types, not vice versa. Placement: domain types, domain schemas, and API DTO schemas live in `@fileshed/core` (shared client/server); DB row shapes and row ⇄ domain transforms are a server resource-access implementation detail and never enter core.

---

## 3. Data Model

All primary keys are **cuid2** strings, generated app-side. cuid2 is deliberately non-monotonic — order by `created_at`, never by id.

### 3.1 Core entities

- **user** — BetterAuth-managed identity plus app profile (quota limit, role: admin/user).
- **node** — a file, folder, or link. Fields: `id`, `type` (file|folder|link), `name`, `owner_id`, `parent_id` (nullable = root level), `blob_id` (files only), `target_node_id` (links only), `size` (logical, files only), `mime_type` (files only), `created_at`, `updated_at`, `trashed_at` (nullable; never set on links — links are deleted, not trashed).
  - A **link** is the recipient-side placement of a shared item: an ordinary node, owned by the recipient, living in their tree, pointing at someone else's node. Links may not target links. Links carry no size, no quota charge, and no ACL of their own.
- **share** — a permission grant. Fields: `id`, `node_id`, `grantee_user_id`, `role` (viewer|editor), `created_by`, `created_at`.
- **public_link** — tokened anonymous access to a node. Fields: `id`, `node_id`, `token`, `created_at`, `revoked_at`.
- **share_request** — a recipient-initiated ask for access (§3.5). Fields: `id`, `node_id`, `requester_id`, `requested_role`, `status` (pending|granted|declined), `created_at`, `resolved_at`.
- **blob** — content-addressed storage record. Fields: `sha256` (PK), `size`, `backend_id`, `storage_key`, `created_at`, `deleted_at` (nullable, GC grace marker).
- **deletion_offer** — a time-boxed "save a copy" offer created when an owner hard-deletes a shared file with recipients-may-copy enabled (§4.4). Fields: `id`, `sha256` (FK → blob, `ON DELETE CASCADE`), `offeree_id`, `name`/`mime_type`/`size` snapshot, `created_by`, `created_at`, `expires_at` (= the blob GC grace deadline).
- **storage_backend** — configured backend instances: `id`, `kind` (fs|db|s3|azure), config JSON, `is_default`.

### 3.2 Trees: per-user, with links

There is no global tree. Each user has an implicit root (their "My Drive"). Shared items enter a user's tree as **link nodes** (§3.1) — ordinary nodes the recipient moves, renames, and deletes with the same code paths as everything else. Listing children is a single query over nodes; links resolve their target for display (name defaults to the target's current name unless renamed; UI shows a link badge + owner).

Parent-edge rule: `parent_id` points to a folder owned by the same user, **except** nodes created inside a folder shared to the creator as editor (§3.3) — the one sanctioned cross-owner edge.

Link behavior:

- Deleting a link removes the item from your tree only. The target node and the share are untouched. (UI: "Remove from my drive.")
- Moving/renaming a link changes nothing for the owner or other recipients.
- Creating a link requires an active share on (or ownership of) the target. Links may not target links.
- When access to the target is lost — share revoked or left, target moved out of the shared subtree, folder trashed — links go **dead** but persist, rendering as stubs (§3.2b). Hard-deleting the target is the only thing that removes links, via FK cascade. There is no background cleanup pass.
- Inside a linked folder, the recipient sees the owner's subtree as-is. Recipients do not re-arrange the interior of someone else's folder except via editor permissions (real moves, visible to everyone).
- Cycle prevention applies to real parent edges only; links don't participate in ownership traversal and cannot create true cycles.

### 3.2a Access vs placement

Shares grant access; links are placement. Independent lifecycles:

- A new share does **not** auto-create a link. It appears in the recipient's **Shared with me** view — a virtual listing (query over the recipient's active shares), not a folder. Every item there offers "Add to my drive" (creates a link in a folder of your choosing); placed items show where they live.
- Deleting your link does not revoke access — the item remains in Shared with me, re-placeable anytime.
- Ending access is explicit: the owner revokes the share, or the recipient **leaves** it (deletes the grant and their links).

### 3.2b Link semantics

Links are inert pointers. They **never conduct permissions** — every resolution re-runs the ACL check as the viewer, against the target's *real* ancestor chain (POSIX symlink / Drive shortcut semantics). All authority lives in ownership + share rows; the permission resolver is the single gate.

- Self-links (linking your own node) are allowed. Same rules, no special casing.
- A link's kind is **derived, never stored**: `link.owner_id = target.owner_id` → organizational; otherwise cross-owner, meaningful only while a share is active. No flag column — a stored flag could disagree with reality.
- A share on a folder does **not** extend through links inside it. When a user places a link into a folder that has grants (or shares a folder containing their links), the UI offers to also share the target — creating an explicit share row, the only granting mechanism. Future editor re-sharing mints explicit share rows clamped to `role ≤ granter's effective role`; never implicit traversal.
- **Unresolvable links render as stubs**: link badge, the link node's stored name, target owner, "you don't have access", with [Request access] (§3.5) and [Remove from my drive]. Same rendering for the placer and for viewers of a shared folder containing the link.
- **Dead links persist** (dangling-symlink semantics). Transient access loss — revoke, leave, target moved away, trash — heals in place: when access returns, the link resumes resolving with no state change. A user-initiated "clean up broken links" action purges all dead links within a folder. No background reaper: access and placement have independent lifecycles (§3.2a), and a reaper racing transient revocations would permanently destroy recipient placement data over temporary access changes.
- Hard-deleting a target is the only permanent death: `node.target_node_id` is a real FK with `ON DELETE CASCADE`, so links to a deleted node are removed by schema, transactionally, across all trees.

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
- Permission resolution must be a single indexed query or cheap recursive CTE — it runs on every request. Both Postgres and SQLite support recursive CTEs; write it once in Kysely. Links never enter this walk (§3.2b) — resolution stays a pure ancestor traversal.

### 3.5 Share requests

Any user who can see that an item exists but cannot resolve it (a stub, §3.2b) may request access. Requests route to the **target's owner** — never the folder sharer, who has no granting authority in v1 — and appear in the owner's "Sharing requests" view. Granting creates an ordinary share row and resolves the request; declining just resolves it. v1 is in-app only (no email notifications).

### 3.6 Invariant enforcement (three layers)

Every rule lives at the deepest layer that can actually enforce it:

1. **Codecs** (`@fileshed/core`, Zod) — shape. A link cannot carry `blob_id`; a folder cannot carry `size`. Strict schemas reject wrong-variant fields rather than stripping them.
2. **Regulation engine** (server, pure) — cross-record legality. Link targets must be file|folder and owned-or-shared by the creator; no link-to-link; parent edges same-owner except §3.3; grants clamped to the granter's effective role; quota admits the write. Managers gather the needed state, the engine judges it — zero I/O, so the entire invariant layer tests without mocks. Violations are typed errors. (Pattern: record-service's regulation engines, adapted to keep engines pure.)
3. **DB constraints** — statically-expressible invariants: per-type CHECK constraints (e.g. `type = 'link'` ⇒ `target_node_id IS NOT NULL AND blob_id IS NULL AND size IS NULL`), real FKs including `target_node_id … ON DELETE CASCADE` and `deletion_offer.sha256 … ON DELETE CASCADE`.

Dynamic validity — "is this cross-owner link backed by an active share?" — is deliberately *not* stored or policed by jobs. It is derived at read time by the permission resolver, the single security gate. A link row asserts placement only and carries no authority.

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

Every file is hashed and claimed; the claim decides whether its bytes travel at all.

1. Client computes SHA-256 incrementally (hash-wasm over `File.stream()`).
2. `POST /api/blobs/claim { sha256, size }`
3. Server:
   - Blob unknown → respond `{ upload: true, ticket, chunkBytes }`. Client delivers the bytes against `PUT /api/uploads/:ticket` (§4.3a). The server verifies the assembled bytes against the claimed hash (reject mismatch — a lying client must not poison the store), then commits: move to backend, insert/resurrect blob, create node.
   - Blob known but under 1 MiB → respond with a ticket as above. Re-uploading costs less than the round trips a proof would spend.
   - Blob known (including graveyarded) → **proof-of-possession challenge**: respond `{ challenge_id, nonce, ranges: [[offset, length], …] }` — 2–4 ranges, random offsets and lengths, single-use, TTL 60s.
4. Client answers: `File.slice()` each range, compute `HMAC-SHA256(nonce, range₀ ‖ range₁ ‖ …)`, `POST /api/blobs/claim/:challenge_id`.
5. Server reads the same ranges via `BlobStore.read`, verifies the HMAC, then (in one transaction) resurrects if graveyarded, creates the node. Zero bytes uploaded.

Security requirements:

- Ranges MUST be random per challenge (fixed ranges are harvest-and-replay-able). Nonce-keyed HMAC prevents replay across challenges.
- Failed challenges are logged with user id and rate-limited per user (a failed proof = someone probing hashes they don't possess).
- Challenges are single-use and expire; unanswered challenges are just dropped.

### 4.3a Chunked delivery

The bytes travel as a sequence of PUTs against one ticket, so the largest request a deployment must accept is one chunk rather than one file — that is the size a fronting proxy's request-body cap has to clear.

- `PUT /api/uploads/:ticket?offset=<n>` carries one chunk, with the commit metadata on the query string. An absent offset means the start of the file.
- Chunks are strictly sequential: each must start exactly where the last one ended. A chunk that repeats or skips ground the upload has already covered is refused `409` with the position it should have carried, as is a second chunk arriving while one is still being received. A chunk that would run past the claimed size is refused `400`. Every such refusal happens before a byte is read.
- A chunk that leaves the file incomplete answers `202 { receivedBytes, totalBytes }`. The chunk carrying the final byte verifies the assembled file against the claimed hash and size and commits it, answering the node — there is no separate finalize call.
- The ticket survives every chunk but the last, so a failed chunk is retried on its own instead of restarting the file. A request that carries the whole claimed size at offset 0 streams straight through and spends its ticket in one shot, which is what a client with nothing to chunk sends.
- Staging is truncated to the accepted offset before each append, so bytes from an attempt that died mid-flight leave no trace in the file.
- An upload's position lives in memory with its ticket. A restart mid-upload loses the partial: the client re-claims and sends the file again, and the abandoned staging bytes are reclaimed by a sweep on the same timer that expires tickets.
- `chunkBytes` in the claim response is the size to cut the file into — `UPLOAD_CHUNK_BYTES`, 8 MiB by default and settable per deployment (minimum 1 MiB, no maximum). Clients plan against the value their claim returned, never a compiled-in constant.
- A file over the instance's upload cap is refused `413` carrying the ceiling it broke, in the body's `maxBytes` and in an `Upload-Limit: max-size=<bytes>` response header.

### 4.4 Trash & delete semantics

- Trashing a node sets `trashed_at`; subtree is hidden from normal listings, visible in Trash. **Trashed files still count against the owner's quota** (matches Drive; prevents trash-as-free-storage).
- Restore clears `trashed_at`; if the original parent is gone, restore to owner's root.
- Permanent delete (manual or auto-purge after 30 days, configurable) removes the node; blob ref-counting handles the rest. Links targeting the node die with it by FK cascade (§3.2b).
- Trashing a shared folder (by owner) hides it from all recipients. Recipients cannot trash nodes they don't own — they delete their link instead. Links are deleted directly, never trashed (they're re-creatable from Shared with me).

Copies & deletion offers:

- **Save a copy**: any file shared to you offers "Save a copy to my drive" — a new file node owned by you referencing the same blob (zero bytes moved, dedup by design). Your quota is checked and charged at copy time (§5). The copy is fully independent thereafter; the owner's later actions never touch it.
- Hard-deleting a file with active shares prompts the owner: **"Delete for everyone"** (default) or **"Let current recipients save a copy"**. Opting in creates a `deletion_offer` per active recipient, time-boxed to the blob GC grace window — the §4.2 graveyard already keeps the bytes alive for exactly that long. Accepting = quota check + create an owned file node + resurrect the blob via the §4.2 claim path. Declining or expiry does nothing; when GC hard-deletes the blob, pending offers vanish by FK cascade. Auto-copying without recipient consent is explicitly rejected — copies charge the recipient's quota and require their acceptance.

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
- The token is the whole capability. It serves the bytes inline — hotlinking is the point of the address — and `?download` on the URL serves the same token as a forced download. Presentation is the requester's choice, never a property of the link: whoever can render a file can save it.
- MUST support: HTTP `Range` requests (byte ranges, single range sufficient), `ETag` (the blob sha256 is the natural etag), `If-None-Match`, `Accept-Ranges`, correct `Content-Length`.
- Links are revocable; multiple links per node allowed. Revoking one kills both forms of it — they are one token.
- No auth on `/d/:token` by design. Token entropy ≥ 128 bits.
- Optional per-link toggles deferred to post-v1: expiry, password, download counting.

---

## 7. API

REST, JSON, cookie session auth (BetterAuth). Sketch — exact DTOs defined in code with Zod:

- `GET /api/nodes/:id` · `GET /api/nodes/:id/children` (owned nodes and links interleaved, paginated, sortable)
- `POST /api/nodes` (create folder) · `PATCH /api/nodes/:id` (rename/move) · `POST /api/nodes/:id/trash` · `/restore` · `DELETE /api/nodes/:id` (permanent)
- `POST /api/blobs/claim` · `POST /api/blobs/claim/:challengeId` · `PUT /api/uploads/:ticket`
- `GET /api/nodes/:id/download` (authed download, same Range/ETag behavior as public links)
- `POST /api/nodes/:id/shares` · `DELETE /api/shares/:id` · `GET /api/nodes/:id/shares`
- `POST /api/nodes/:id/links` · `DELETE /api/links/:id`
- Links are plain node CRUD: `POST /api/nodes` with `type: link` + `target_node_id`; move/rename/delete via the node endpoints
- `GET /api/shared-with-me` (active shares + placement status) · `POST /api/shares/:id/leave`
- `POST /api/nodes/:id/copy` (save a copy) · `POST /api/nodes/:id/purge-broken-links` (folder-scoped, user-initiated)
- `POST /api/nodes/:id/access-requests` · `GET /api/access-requests` (incoming for owners, outgoing for requesters) · `POST /api/access-requests/:id/grant` · `POST /api/access-requests/:id/decline`
- `GET /api/deletion-offers` · `POST /api/deletion-offers/:id/accept` · `POST /api/deletion-offers/:id/decline`
- `GET /api/search?q=` (name OR embedded-tag match — title/artist/album extracted from audio content at upload,
  keyed by blob so dedup'd copies share tags; a background sweep backfills pre-existing libraries — scoped to
  accessible nodes)
- `GET /api/me` (profile, quota used/limit) · admin: user CRUD, quota management, backend status, GC status

All node-returning endpoints include the caller's effective role on each item.

### 7.1 Access Tokens

A second authentication plane beside the session cookie: **identity delegation, never node capability**. A token
authenticates as its owner and then normal authorization runs unchanged — contrast `/d/:token`, which is an
anonymous capability published only by an owner. Do not unify the two surfaces; they answer different questions.

- Backed by the `@better-auth/api-key` plugin, two configurations in one table: `pat` (durable, user-managed,
  `fspat_` prefix, name required, optional 1–365-day expiry) and `playback` (system-minted by the media player,
  `fsplay_` prefix, ~5-hour expiry, never listed). Keys are hashed at rest; the full value appears exactly once, in
  the create response.
- Transport: `Authorization: Bearer` or `?token=` on opted-in routes. The query form exists because media elements
  and cast receivers cannot send headers; it is why AirPlay/cast receivers can fetch bytes at all.
- **Scopes are UI-level bundles; stored statements are explicit `{ resource: [actions] }` records; routes demand
  single actions; verification is exact containment with no hierarchy.** Broader scopes STORE the narrower actions
  (`files:write` carries read and download). A key's statement is frozen at mint — scopes added later never accrue
  to old keys, and the UI's Full-access/Read-only presets only tick real checkboxes, deliberately.
- Vocabulary: `files:download`, `files:read`, `files:write`, `shares:read`, `shares:write` (publish-capable —
  badge it), `account:read`.
- Never token-reachable: `/api/auth/*` (the api-key plugin's own endpoints are gated like the admin surface —
  `/api/me/access-tokens` is the only management surface), token minting itself (no laundering), permanent deletion
  (`DELETE /api/nodes/:id`, `DELETE /api/trash`), preferences/avatar writes, admin.
- Tokens survive sign-out and password change (standard PAT semantics), but die with revocation, with their
  owner's ban or deletion (database hooks delete the rows; the identity seam re-checks the user on every verify as
  the backstop), and on expiry.
- Byte responses on the token plane are `cache-control: private, no-cache` — revalidation stays cheap via the
  content-hash ETag, and Range keeps working.

---

## 8. Frontend

The UX bar is the mainstream cloud file managers. Nuxt UI v4 provides the chrome (dialogs, menus, toasts, forms, tables); the core file-management surface is custom:

- **Main view**: grid and list modes, sortable columns (name, size, modified, owner), breadcrumb path, folder tree sidebar.
- **Selection**: click, ctrl/shift-click, marquee (drag-select). Keyboard: arrows, enter to open, del to trash, F2 rename.
- **Drag & drop**: move within tree (including drop on sidebar folders), drop-from-OS to upload (files and folders via webkitdirectory/DataTransferItem traversal).
- **Context menus** on nodes and empty space: open, download, share, get link, rename, move, remove from my drive, trash — filtered by effective role.
- **Upload manager**: bottom-right panel, per-file progress, hash-then-claim phase shown ("checking…" → instant complete on dedup hit), cancel, error retry.
- **Share dialog**: user picker, role select, current grants list, public link management (create a link, copy it plain or as a download, revoke).
- **Shared-item affordances**: shared objects must be immediately identifiable at a glance — link badge + owner on links, "shared" indicator on nodes you own that have grants. "Leave share" is a standard action on any shared-with-you object (context menu on the link *and* in Shared with me). "Remove from my drive" (delete link) triggers a prompt offering to also leave the share — deleting the placement without surfacing that option leaves the item haunting Shared with me, which users will file as a bug. "Trash" applies to owned nodes only.
- **Link stubs**: unresolvable links render greyed with a link badge, stored name, target owner, "you don't have access", [Request access], [Remove from my drive]. Folder context menus offer "Clean up broken links" (user-initiated purge, §3.2b).
- **Sharing requests**: owners get a "Sharing requests" view (grant/decline); requesters see request status on the stub. "Save a copy to my drive" appears on any file shared to you; pending deletion offers surface alongside Shared with me.
- **Shared with me view**: virtual listing of active shares with placement status and "Add to my drive".
- **Trash view**, **quota meter** in sidebar, name search in header.
- **Narrow viewports**: supported down to 360px wide, with the sidebar moving into a drawer opened from the header below the `md` breakpoint.
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
4. Shares, links, permission resolution, share requests; save-a-copy + deletion offers (rides §4.2 claim/graveyard).
5. Direct links with Range/ETag.
6. Frontend shell → main view → uploads → sharing → trash/search.
7. Remaining backends (db, S3, Azure) against the BlobStore contract + its test suite.

## 11. Future Work (explicitly deferred)

Resumable uploads (tus), file versioning, editor re-sharing (explicit clamped share rows, §3.2b), ownership transfer, email notifications for share requests/deletion offers, link expiry/passwords, full-text search, docs/sheets editing, backend-to-backend blob migration tooling, WebDAV.
