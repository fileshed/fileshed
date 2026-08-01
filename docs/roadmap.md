# Roadmap

What FileShed does today and what is planned. Nothing here is dated, and the post-1.0 list is a set of things being
considered rather than commitments.

## Shipped

- [x] Accounts, with a first-run setup flow that creates the instance admin
- [x] Content-addressed storage with SHA-256 dedup
- [x] Browser-side hashing, so a file the instance already holds uploads instantly
- [x] Filesystem storage backend
- [x] Shared folders with viewer and editor roles, placed anywhere in the recipient's own tree
- [x] Public links, per file, set to inline or download
- [x] Per-user quotas with an instance-wide default
- [x] Trash with a retention window, and a grace period for deleted files
- [x] Audio and video playback
- [x] PDF viewing and annotation
- [x] Text and Markdown editors with autosave
- [x] Name search with type, owner, and modified-date filters
- [x] Admin: user management, quota overrides, and bans
- [x] Admin: outgoing mail configuration
- [x] Admin: OAuth sign-in provider configuration
- [x] Admin: branding and theming, including custom CSS and a logo
- [x] Admin: instance settings that apply live
- [x] Admin: status dashboard
- [x] User avatars
- [x] Personal access tokens and media playback tokens
- [x] Docker image and compose file
- [x] CI

## Before 1.0

- [ ] Responsive layout for small screens
- [ ] Search results that show where a file lives
- [ ] General hardening

## Under consideration after 1.0

- [ ] Additional storage backends: S3-compatible, Azure, database blob
- [ ] WebDAV and SFTP access
- [ ] Expiring links and shares
- [ ] Richer search
