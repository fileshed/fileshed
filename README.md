# FileShed

Self-hosted, multi-user file hosting, inspired by cloud file management tools like Dropbox and Google Drive. Content-addressed storage with SHA-256 deduplication, pluggable storage backends, and true shared folders where recipients place shared items anywhere in their own tree. This is early, in-development software — the shape below tracks the v1 scope in `docs/design/requirements.md`.

## Features

- Multi-user file hosting: nested folders, sharing, and a UI that doesn't suck.
- Direct links: both forced-download and hotlinkable inline URLs for image and video hosting.
- Shared items are first-class — recipients place shared files and folders anywhere in their own tree, no "Shared with me" ghetto.
- True shared folders: editors can add files and create subfolders inside a folder shared with them.
- Content-addressed storage with SHA-256 deduplication.
- Pluggable storage backends: filesystem, database blob, S3-compatible, Azure Blob.
- Optional per-user storage quotas, charged by file ownership.

## Quickstart

```bash
git clone <repo-url> fileshed
cd fileshed
npm install
cp .env.sample .env      # then edit HOST / PORT / LAUNCH_EDITOR
npm run dev              # client dev server with the API in-process
```

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Vite client dev server, API in-process |
| `npm run dev:server` | Start the Hono backend standalone |
| `npm run build` | Build all packages |
| `npm run lint` | Lint all code |
| `npm run lint:fix` | Lint and auto-fix |
| `npm run lint:types` | Type-check without emitting |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Layout

npm workspaces monorepo:

- `packages/core` — `@fileshed/core`, domain types and Zod codecs
- `src/client` — `@fileshed/client`, the Vue 3 + Nuxt UI v4 frontend
- `src/server` — `@fileshed/server`, the Hono API

## Docs

- `docs/design/requirements.md` — v1 scope and technical design, the source of truth.
- `CLAUDE.md` — development guidelines, code style, and architecture.
