# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/fileshed/fileshed/compare/v0.1.0...main
[0.1.0]: https://github.com/fileshed/fileshed/releases/tag/v0.1.0
