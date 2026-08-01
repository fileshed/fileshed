# Contributing to FileShed

Contributions are welcome — bug reports, fixes, features, docs, all of it. FileShed is early, in-development
software, so there is plenty of surface that could be better. If you are planning something large, open an issue
first so we can talk about the shape of it before you spend a weekend on it.

## Licensing, plainly

FileShed is released under the **GNU Affero General Public License v3.0** (`AGPL-3.0-only`). See [LICENSE](LICENSE).

Everything released under the AGPL stays under the AGPL. Permanently, irrevocably. Nobody — including the project
owner — can pull a published release back out of free software. If you are deciding whether to build on FileShed,
that guarantee is the one that matters, and it is not going anywhere.

Contributions require a one-time **[Contributor License Agreement](.github/CLA.md)**. The short version:

- **You keep your copyright.** The CLA is a license, not an assignment. Your code stays yours to do anything you
  want with, anywhere else, forever.
- It grants the project the right to relicense your contribution, including under commercial terms. That is what
  makes dual licensing possible, and dual licensing is what pays for the project to keep being maintained.
- It is a bot, not paperwork. Open your first pull request, a bot comments, you reply with one line, and you are
  done — every pull request after that is covered automatically.

If that arrangement isn't for you, that is a legitimate position and no hard feelings — but the pull request can't
be merged without a signature.

## Getting set up

Node 24 or newer. Node runs TypeScript natively now, so there is no build step to fight with.

```bash
git clone https://github.com/fileshed/fileshed.git
cd fileshed
npm install
cp .env.sample .env      # then edit HOST / PORT / LAUNCH_EDITOR to taste
npm run dev              # Vite client dev server, API running in-process
```

That gives you the whole app on one port with hot reload. `npm run dev:server` runs the Hono backend standalone if
you only care about the API.

`.env.sample` documents the variables a dev box usually sets. The committed `config/config.yaml` is the
configuration of record — values there substitute against your environment, so the variables flow through that file
rather than around it.

## The four gates

```bash
npm run lint             # eslint, zero warnings tolerated
npm run lint:types       # type-check every workspace, no emit
npm run test             # Vitest unit and integration suites
npm run test:e2e         # end-to-end: spawns a real server, drives it over real HTTP
```

Run all four before you open a pull request, and expect your change to keep them green. `test:e2e` is deliberately
excluded from `npm test` because it is slower and spawns real processes — run it anyway. It is the suite that
catches the things unit tests are structurally incapable of noticing.

If a gate fails for reasons that look unrelated to your change, say so in the pull request rather than working
around it. Sometimes it really is unrelated, and that is worth knowing.

## Tests are spec-first

This one matters more than the rest, so it gets its own section.

Tests here are derived from the **contract** — what the code is supposed to do — never reverse-engineered from what
the implementation happens to do. Decide the expected value by hand from the requirement, then read the code only to
learn how to call it. Never run the code and paste its output back as the assertion; that enshrines today's bugs as
the specification and produces a suite that passes no matter what.

The tell for a test written the wrong way around: you fix a genuine bug and a "passing" test breaks. That test was
coded to the implementation. It was never a spec.

Full rules, with examples of both failure modes, live in
[.claude/skills/writing-tests/SKILL.md](.claude/skills/writing-tests/SKILL.md). Read it before writing assertions.
Tests live in `tests/{server,client,core}/` mirroring source, named `*.spec.ts`.

## Style

Code style lives in [CLAUDE.md](CLAUDE.md) and eslint enforces the mechanical parts — 4-space indentation, 120
column limit, Allman braces, camelCase filenames including Vue components. `npm run lint:fix` handles most of it.

Two rules eslint can't check for you:

- **No `any`, no non-null assertions (`!`).** Use `unknown`, a generic, or an actual type guard.
- **Comments earn their place.** Say something the code cannot. No narrating the next line, no restating a
  signature, no "updated to..." notes aimed at a reviewer. If deleting a comment loses nothing but word count,
  delete it.

## Pull requests

Keep them focused — one concern per pull request reviews far better than a grab bag. Explain what changed and why;
the "why" is the part reviewers can't reconstruct from the diff. Note which gates you ran.

Reporting a bug rather than fixing one? Include what you did, what you expected, what happened instead, and your
database backend (SQLite or Postgres). Server logs help.
