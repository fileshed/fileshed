# FileShed Development Guidelines

## Project Overview

**FileShed** (`fileshed` internally — repo, package, binary) — self-hosted, multi-user file hosting with a Google Drive-class UX.

"Google Drive-class UX" is internal shorthand only. Externally-facing copy (README, UI strings, public docs) must not invite that comparison — phrase it as "inspired by cloud file management tools like Dropbox or Google Drive" instead.

Content-addressed storage with SHA-256 dedup, pluggable backends (filesystem, DB blob, S3, Azure), true shared folders, hotlinkable direct links, and per-user quotas charged by file ownership. Domain types are canonical TypeScript with Zod codecs at every boundary (DB rows ⇄ domain, API DTOs ⇄ domain); tables serve the domain types, not the reverse.

- **@fileshed/core** (`packages/core`) — domain types + Zod codecs, shared by client and server
- **@fileshed/client** (`src/client`) — Vue 3 / Vite frontend with Nuxt UI v4
- **@fileshed/server** (`src/server`) — Hono API
- Monorepo with npm workspaces

See `docs/design/requirements.md` for the full v1 scope and the technical decisions behind it. It is the source of truth — when this file and the requirements disagree, the requirements win.

## Stack

The decided stack (versions live in `package.json`, not here — don't quote them in prose):

- **Server**: Hono, with `@hono/node-server` and `@hono/zod-validator`
- **DB access**: Kysely, one query builder across **both** dialects — Postgres (primary target) and SQLite (supported convenience deployment). Feature parity required; when a tradeoff appears, Postgres wins and SQLite gets the workaround.
- **Auth**: BetterAuth (`better-auth`) — email/password v1, OAuth providers are config not code
- **Validation / codecs**: Zod v4
- **Logging**: pino (structured)
- **IDs**: cuid2, generated app-side. cuid2 is deliberately non-monotonic — **order by `created_at`, never by `id`**.
- **Client hashing**: hash-wasm for incremental SHA-256 over `File.stream()` — never `crypto.subtle.digest` (needs the whole file in memory)
- **Tests**: Vitest

## Environment

Copy `.env.sample` to `.env` and adjust values. The `.env` file is gitignored.

```bash
HOST=0.0.0.0            # Server bind address
PORT=3000              # Server port
LAUNCH_EDITOR=webstorm  # Editor for Vue DevTools "open in editor"
```

## Commands

```bash
npm install              # Install all dependencies
npm run dev              # Vite client dev server, API in-process via @hono/vite-dev-server
npm run dev:server       # Start Hono backend standalone (loads .env)
npm run build            # Build all packages
npm run lint             # Lint all code
npm run lint:fix         # Lint and auto-fix
npm run lint:types       # Type-check without emitting
npm run test             # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
```

## Code Style

### File Naming

- **All files use camelCase**: `blobStore.ts`, `nodeManager.ts`, `uploadPanel.vue`
- Vue components are also camelCase: `shareDialog.vue`, not `ShareDialog.vue`

### Indentation & Formatting

- **4-space indentation**
- **120 character line limit**
- **Allman brace style** with single-line allowance:

```typescript
function example()
{
    if(condition)
    {
        // code
    }
}

// Single-line allowed
if(simple) { return true; }
```

### Comment Breaks

Use dashes filling to 120 characters to separate file sections:

```typescript
//----------------------------------------------------------------------------------------------------------------------
// Section Name
//----------------------------------------------------------------------------------------------------------------------
```

- Files start and end with a comment break
- Use blank lines to separate major sections

File headers are **title-only by default**. Add a description only when it states a constraint the code can't show
(an invariant, an ordering requirement, a non-obvious why). Never narrate future work, changesets, scaffolding
status, or what the file will become — comments describe the code that exists, not the plan.

No AI slop comments anywhere: nothing that narrates the next line, restates a signature, explains language
features, duplicates a type in JSDoc, or talks to a reviewer ("updated to...", "now uses..."). If deleting a
comment loses nothing but word count, delete it.

### Import Organization

1. External library imports first
2. Blank line
3. Internal imports grouped by type with comment headers:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';

// Models
import type { Node } from '@fileshed/core';

// Managers
import { NodeManager } from './managers/node.ts';

// Resource Access
import { NodeRA } from './resource-access/node.ts';

// Utils
import { validate } from './utils/validation.ts';
```

### TypeScript Conventions

- Use `import type` for type-only imports
- Async functions return `Promise<T>`
- Use explicit return types on exported functions
- Spaces around type annotations: `id : string` not `id: string`
- Spaces in brackets: `[ 1, 2, 3 ]`, `{ key: 'value' }`
- Template literals with spacing: `${ variable }`
- **FORBIDDEN**: Never use `any` type - use `unknown`, generics, or proper types instead
- **FORBIDDEN**: Never use non-null assertions (`!`) - use proper null checks or type guards

## Architecture Patterns

### iDesign Architecture

The server follows **iDesign methodology** - a layered architecture with strict separation of concerns:

1. **Clients** - External consumers (API routes, CLI, etc.)
2. **Managers** - Business logic orchestration (coordinate multiple operations)
3. **Engines** - Pure business logic (no I/O, stateless, easily testable)
4. **Resource Access** - Data persistence (database, blob backends, external APIs, all I/O)
5. **Utils** - Cross-cutting concerns (logging, validation helpers)

Key principles:
- Each layer only calls the layer directly below it
- Managers coordinate between Engines and Resource Access
- Engines contain pure logic, easily testable
- Resource Access handles all I/O operations

Good candidates for the split: permission resolution (effective role, cycle checks) and quota math are **engine** logic — pure, no I/O, exhaustively testable. Blob backends and the Kysely queries behind them are **resource access**. The claim/proof-of-possession dance and share/link lifecycle live in **managers**.

### Manager Pattern

```typescript
//----------------------------------------------------------------------------------------------------------------------
// Node Manager
//----------------------------------------------------------------------------------------------------------------------

import { NodeEngine } from '../engines/node.ts';
import { NodeRA } from '../resource-access/node.ts';

//----------------------------------------------------------------------------------------------------------------------

class NodeManager
{
    private readonly engine = new NodeEngine();
    private readonly ra = new NodeRA();

    async get(id : string) : Promise<Node>
    {
        return this.ra.get(id);
    }

    async rename(id : string, name : string) : Promise<Node>
    {
        // Engine validates/transforms
        const validated = this.engine.validateName(name);

        // RA persists
        return this.ra.rename(id, validated);
    }
}

//----------------------------------------------------------------------------------------------------------------------

export default new NodeManager();

//----------------------------------------------------------------------------------------------------------------------
```

## Vue Guidelines

### Component Structure

```
componentName/
├── componentName.vue    # Template → Style → Script
├── types.ts             # Exported types (if needed)
└── index.ts             # Re-exports (if needed)
```

### Vue File Order

1. `<template>` - HTML
2. `<style lang="scss" scoped>` - Styles
3. `<script setup lang="ts">` - Logic

With HTML comment breaks between sections.

```vue
<!----------------------------------------------------------------------------------------------------------------------
  -- Component Name
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="my-component">
        Content
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style lang="scss" scoped>
    .my-component {
        /* styles */
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Component logic

    //------------------------------------------------------------------------------------------------------------------
    // Section Name
    //------------------------------------------------------------------------------------------------------------------
</script>

<!--------------------------------------------------------------------------------------------------------------------->
```

### Nuxt UI

The client uses **Nuxt UI v4** in standalone Vue mode (via its Vite plugin, **not** the Nuxt framework), on **Tailwind CSS v4**. Nuxt UI v4 is MIT and folds in the former Pro components. It supplies the chrome — dialogs, menus, toasts, forms, tables; the core file-management surface (grid/list, selection, drag & drop, upload manager) is custom.

- **Docs:** https://ui.nuxt.com
- **LLM reference (concise):** https://ui.nuxt.com/llms.txt
- **LLM reference (full):** https://ui.nuxt.com/llms-full.txt
- **Per-component raw docs:** `https://ui.nuxt.com/raw/docs/components/<name>.md` (e.g. `.../button.md`, `.../modal.md`)

When working with Nuxt UI components, fetch the LLM docs from the URLs above rather than guessing at the API. Use `llms.txt` for a quick overview, `llms-full.txt` or the per-component `.md` for full props/slots/usage.

**Styling: Tailwind utilities first.** No custom styles unless utilities genuinely can't express it (complex selectors, keyframe animations, deep third-party overrides). A component with no custom styles omits the `<style>` block entirely — don't leave an empty one.

### Component Naming

- File names are camelCase: `shareDialog.vue`, `uploadPanel.vue`
- Component registration uses PascalCase in templates: `<ShareDialog />`

## Testing

- Tests live in the top-level `tests/` tree, mirroring source: `tests/server/`, `tests/client/`, `tests/core/`
- Test files are named **`*.spec.ts`** (not `*.test.ts`)
- Run with `npm run test`; use Vitest

**Writing or changing tests requires the `writing-tests` skill** (`.claude/skills/writing-tests/`). It is not optional. Tests are derived from the requirements and the unit's contract — not reverse-engineered from the implementation. Read it before you write a single assertion.

## Workspace Structure

```
fileshed/
├── packages/
│   └── core/                # @fileshed/core — shared domain vocabulary + API contract
│       └── src/
│           └── models/      # Domain type definitions
│               ├── schemas/     # Zod codecs for the domain types
│               └── requests/    # API DTO types + schemas (as the API grows)
├── src/
│   ├── client/              # @fileshed/client — Vue 3 + Nuxt UI v4 frontend
│   │   └── src/
│   │       ├── router/      # vue-router setup
│   │       ├── stores/      # Pinia stores
│   │       ├── styles/      # Global CSS (Tailwind + Nuxt UI imports)
│   │       └── views/       # Route-level views (<name>View.vue)
│   └── server/              # @fileshed/server — Hono API (files at workspace root, no nested src/)
│       ├── app.ts               # Hono app definition (default export)
│       ├── server.ts            # Node entry point
│       ├── routes/              # Route handlers (client layer)
│       ├── managers/            # Business logic orchestration (as they land)
│       ├── engines/             # Pure logic — permissions, quota (as they land)
│       ├── resource-access/     # DB + blob backends, all I/O (as they land)
│       └── utils/               # Cross-cutting helpers (config, logger)
├── tests/                   # *.spec.ts mirroring source: server/ client/ core/
├── docs/                    # Design documents (see docs/design/requirements.md)
├── package.json             # Root workspace config
├── eslint.config.js         # Code style rules
└── vitest.config.ts         # Test configuration
```

## Package Dependencies

- Workspace packages reference each other with caret ranges against the local version, e.g. `"@fileshed/core": "^0.1.0"`
- npm workspaces resolves these to the local package on disk

## Git & Commits

- **Only commit when explicitly instructed** - Never assume the user wants changes committed
- Ask for confirmation before any git operations that modify history or remote
- Do not push unless explicitly requested

## Agent Behavior

### Subagent Strategy

- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how
- A test that fails **because** you fixed a bug is a suspect test, not a broken fix — see the `writing-tests` skill
