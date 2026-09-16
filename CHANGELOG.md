# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The interface says what it is running. About, in the account menu, names the version, the commit it was built
  from, and the branch when there was one, with the commit ready to copy into a bug report, beside links to report
  a bug, read this version's release notes, and read the source.
- The admin overview carries that commit and branch beside the version it already showed, so two deployments of the
  same version can be told apart.
- `GET /api/version` answers the same facts to any signed-in caller. It takes a session on purpose: a version
  number tells a stranger which published vulnerabilities apply to an instance, so it stays out of the anonymous
  handshake. Published images record the commit they were built from; an image built without it, or an install from
  a tarball with no repository behind it, reports none rather than guessing.

## [0.2.0] - 2026-09-14

### Added

- Chunked uploads: bytes travel as a sequence of requests against one ticket, so a connection lost part-way
  through a large file resumes from where it stopped instead of starting over. The chunk size comes from the
  server (8 MiB by default, `UPLOAD_CHUNK_BYTES` to change it), so a deployment behind a proxy with its own body
  cap can cut files to fit, and a refusal over a size limit now says what the limit was.
- Download from the interface: signed-in users get a Download beside Open in the context and kebab menus on the
  drive, shared files and search, and in the viewer and editor headers.
- Download a selection as one archive, `.zip` or `.tar.gz`, streamed as it is built rather than assembled on the
  server first. Folder structure is kept relative to what you selected, a link resolves to the file it points at,
  and anything you cannot read is left out and named in a `SKIPPED.txt` alongside it.
- Links can be made from either end. From a file, its own menu asks where the pointer should go; from a folder,
  New asks what to point at. A link to somebody else's shared file needs only read access, since it is a pointer
  in your own drive rather than a change to what it points at.
- Search results can be selected and dealt with where they were found: Trash and Copy act on a selection spanning
  folders and owners, so cleaning up scattered matches no longer means visiting each one's folder.
- Self-service account deletion. Everything the account reaches outward ends the moment deletion is requested,
  every share, public link, access token and session, so a stolen session cannot go on using it. The account
  itself waits out `ACCOUNT_DELETION_DAYS` and can be brought back at any point before it falls due.
- Sign out everywhere: one action ends every session the account holds, revokes every access token and playback
  key, and cancels the pending password-reset links already sitting in a mailbox.
- An upload filename filter an admin can edit, shipping with `.DS_Store`, `._*`, `Thumbs.db` and `desktop.ini`.
  The browser applies it before hashing a byte, and reports a count rather than a failed row per skipped file.
- Admins can run a maintenance sweep on demand instead of waiting out the interval, and get the sweep's own
  counts back: garbage collection, the trash purge, and abandoned upload staging, each with the bytes it
  reclaimed.
- Grid or list is now remembered per device, so a phone can sit on list while the desktop stays on grid. A device
  with no opinion of its own follows the account preference.
- Sharing badges on tiles, rows, search hits and editor headers. A node says how many people it is shared with
  and whether a public link stands, and a node with a live link hands the URL out from its menu.
- An instance can answer on more than one origin. `TRUSTED_ORIGINS` lists further origins beside `BASE_URL`, and
  a request arriving on a listed one is answered as that origin, sign-in, provider callbacks, and the links in
  verification and password-reset email included.
- A per-reader switch for playlist entries pointing at other sites. A playlist is something one user hands
  another, and opening one hands whoever runs that address your IP and the moment you opened the file, so the
  choice belongs to the reader rather than the author. On by default; turned off, the entry keeps its row and is
  never fetched.

### Changed

- Listings are virtualized throughout. A folder of ten thousand files paints in about 140ms, Load more is gone,
  and once a folder has arrived, sorting and filtering it happen in the browser with no request and no scroll
  reset. Past fifty thousand items it keeps loading as you scroll and leaves the work to the server.
- A public link is one token, and inline or download is how you copy it rather than a property of the grant.
  Anyone who can view bytes inline can save them, so the choice lives in the URL: `/d/:token` serves inline, and
  `?download` saves. **BREAKING** for API clients: the create-link request no longer takes a body, and the `mode`
  and `disposition` columns are dropped by migration 007.
- The PDF viewer gets the chrome it was missing. A sidebar carries page thumbnails, the document outline, and any
  files embedded in the PDF; pages step one at a time beside the page box; find gains whole-word matching,
  diacritic matching, and a highlight-all switch; annotations can be undone and redone; pages lay out vertically,
  horizontally, wrapped or one at a time, with optional facing pages; a pan tool drags the page when you are
  zoomed past the window; and full screen and a document-properties dialog are both there. An image can be
  stamped onto a page beside the existing text, drawing and highlight tools, and given a description for anyone
  reading with a screen reader. The keyboard map is the one Mozilla's viewer taught: arrows or n and p to page,
  Home and End for the ends, plus and minus to zoom, r to rotate, F4 for the sidebar. A document now opens at
  automatic zoom rather than stretched to the window's width.
- The public-link badge is a globe. A chain already marked a link node on the same tiles and rows, so one glyph
  was standing for two unrelated things.
- `BASE_URL` defaults to `http://localhost:7433` rather than Vite's `5173`, which every other project on a
  machine also wants. A deployment that sets `BASE_URL` is unaffected, which is every deployment that works.
- better-auth updated to 1.7.2, nodemailer to 9.1.1 and hono to 4.13.7, clearing every high and moderate advisory
  in the dependency tree.

### Fixed

- Deleting an account reclaims the storage it owned. The user row cascades to their files, so deleting it first
  took the rows and left the bytes on disk with nothing referencing them and nothing able to find them.
- A dropped idle database connection no longer ends the server process. A PostgreSQL restart, a failover, an
  administrative terminate, `idle_session_timeout`, or a firewall reaping a quiet socket all arrived as an error
  with nothing listening for it; they are logged now, and the next query dials a fresh connection.
- Bytes from a refused write are no longer stranded on disk. Blob bytes are published before the record
  referencing them commits, so anything refusing inside that commit left bytes that garbage collection could
  never see; the sweep now also walks what is stored and adopts what the records cannot account for.
- Every sort key orders the same way on both sides of the listing ceiling. Size, created, modified and kind were
  ordered by the database on the server and by JavaScript in the browser, and the two disagreed about ties and
  about where an absent value goes, which a reader saw only in a folder large enough that the browser stopped
  re-ordering.
- An upload no longer dies over a collision that clears itself. A chunk torn and immediately re-sent is retried,
  an upload that loses track of where it stands is told where to resume, and a retry arriving after the file has
  already been committed is told the file is stored rather than meeting an expired ticket.
- What is drawn on a PDF page lines up with the page again. pdf.js's stylesheet is written for the browser's
  default box model and the app's own reset is not, so every layer above the page sat up to 18 pixels off it,
  drifting further towards the bottom right corner: search highlights beside their words, selection beside its
  text, and an annotation placed on a word saved slightly next to it.
- The toolbar on a selected annotation works. Its delete button drew the trash icon a couple of hundred pixels
  below the button itself, so pressing the icon you could see pressed nothing at all, and a highlight offered no
  way to change its colour once it had been drawn.
- Printing a PDF prints what is on screen. It used to open the copy held on the server, so annotations that had
  been made but not yet saved were missing from the printout.
- Shift-clicking a range no longer highlights the names and dates it crosses.
- The media-tag backfill cannot start a pass on top of one already running, so a library slower to walk than the
  sweep interval no longer has two passes extracting the same files.
- The container image carries workspace dependencies that npm chose not to hoist, instead of building cleanly and
  dying at boot looking for a package one directory away.
- The auth secret file is created with the secret already in it. Several processes starting together against one
  data directory could read it in the window between creation and the write, and refuse to boot over a file that
  was about to be perfectly good.

### Security

- The app document ships a Content-Security-Policy: script from this origin and nothing else, no framing, no
  plugins, and forms that can only post back here. Every icon the interface draws now comes from this origin as
  well, rather than resolving off a CDN at runtime. Uploaded bytes keep the stricter sandbox policy they are
  already served with.
- Requests are budgeted per client. A client is identified by the connection it arrived on unless the deployment
  names its proxies (`TRUSTED_PROXIES`), so a forged `X-Forwarded-For` buys nothing and a proxy appending its own
  hop no longer puts the whole instance in one bucket. Credentials, the anonymous `/d` links and the API at large
  each carry their own budget, and requests are checked against the origin they claim.
- An instance answers only where it was told to. Both origin allowlists used to open up whenever `NODE_ENV` was
  not `production`, which nobody running the server under systemd sets; the posture is now written down in
  `TRUSTED_ORIGINS` and `ALLOWED_HOSTS`, both of which accept `*` for anywhere, and an instance told anywhere
  says so in the log at every boot. `X-Forwarded-Host` is not read, so no request can name the host that its own
  password-reset link is built on.
- Bodies, names, mime types and rows all have ceilings. A mime type is emitted verbatim as a `Content-Type`
  header, and one carrying a newline left a node's bytes unreadable to everyone, permanently, with no API that
  could repair it.
- Content served inline goes out under its stored type only when a browser renders that type as media. Anything
  else is served as `text/plain`, so uploaded HTML, CSS or JavaScript is shown rather than run, and uploaded
  bytes come back sandboxed. A download is untouched. Avatar, logo and embedded-artwork bytes are checked against
  the type they claim before they enter the store.
- Search is scoped to the caller in the query rather than filtered afterwards. One user uploading enough files
  by the same name used to push everyone else's real matches out of the candidate window.
- Upload staging counts against the quota. A claim entitles a client to put its claimed size on disk, and nothing
  charged for those bytes until the file committed, so concurrent claims were all judged against the same figure
  and an account could hold many times its cap indefinitely. A claim that is never delivered still costs nothing
  once its ticket lapses.
- A password reset now revokes the account's access tokens. better-auth ends every session on a reset and knows
  nothing about ours, so the first thing a worried user reaches for left every personal access token and playback
  key answering indefinitely.
- The interactive API reference is gone from every deployment. It served an anonymous page that loaded its script
  from a CDN and offers to call this API from itself; it is now mounted only when the process is started with
  `--api-reference`, and serves its bundle from this instance. The OpenAPI document stays where it was.
- A playback key is minted when a cast session starts and at no other time. It used to be minted the moment
  anything played and appended to every media request from then on, where reverse-proxy access logs write query
  strings down. In-page playback never needed it.
- Every value substituted into the container's `config.yaml` is quoted, so a password containing `#` arrives
  whole, `no` stays a string, and a setting of `*` no longer kills the boot with a YAML parse error naming the
  YAML rather than the setting.

## [0.1.0] - 2026-08-04

### Added

- Multi-user file drive: folders, drag-and-drop uploads, grid and list views, selection with bulk actions,
  breadcrumbs, and per-user storage quotas charged by file ownership.
- Content-addressed storage with SHA-256 deduplication: identical files are stored once, and re-uploading a
  known file completes without sending its bytes (a sampled-window proof of possession stands in for the
  transfer).
- Sharing: per-user grants with viewer and editor roles, a shared-with-me view with access requests,
  add-to-my-files, and public view and download links.
- Trash with configurable retention, restore, and reclaimed-storage offers when another owner's copy keeps
  the bytes alive.
- Search across everything the caller can see, with each result's location shown and permission-trimmed, plus
  typeahead suggestions from the search box.
- File viewers and editors: plain text and Markdown editors with autosave and conflict detection, a PDF
  viewer with annotations, and an audio/video player with playlists.
- Accounts: email/password sign-in, OAuth providers by configuration, avatars, per-user preferences, and a
  self-service account area.
- Access tokens for scripts and other API clients, minted from the account area with per-capability scopes over
  files, shares, and account reads, an optional expiry, and a single reveal at mint; revocable at any time.
- The session-signing key is generated on first run and kept in a file beside the database (`/data/auth-secret` in
  the container image); it also encrypts the instance secrets an admin enters, which reach the database only as
  ciphertext. `AUTH_SECRET` or `AUTH_SECRET_FILE` supplies your own key instead, `AUTH_SECRET_PREVIOUS` rotates it
  without losing sealed settings, and a sealed setting that no available key opens stops the boot rather than
  being discarded.
- First-run setup: a fresh instance prints a one-time code at boot and the setup page walks the first admin through
  creating their account. The page is gone for good once an account exists.
- Admin area: an overview dashboard, user management (roles, quotas, bans, password resets, session
  revocation), live-applied instance settings, email delivery, authentication providers, and branding.
- Two database dialects behind one query layer: PostgreSQL, and SQLite through the runtime's own driver — no
  native addons anywhere in the tree.
- Docker images for amd64 and arm64 at `ghcr.io/fileshed/fileshed`, with `dev`, `beta`, and `latest` tags.
- A responsive interface, usable down to 360px-wide screens.

[Unreleased]: https://github.com/fileshed/fileshed/compare/v0.2.0...main
[0.2.0]: https://github.com/fileshed/fileshed/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fileshed/fileshed/releases/tag/v0.1.0
