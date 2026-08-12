# Deploying FileShed

FileShed ships as a single container image: one Hono process serves the API and the built web client. SQLite is the
zero-dependency default; Postgres is the primary target for larger deployments.

## Quickstart (Docker)

```bash
docker run -d --name fileshed \
  -p 3000:3000 \
  -e BASE_URL=http://localhost:3000 \
  -v fileshed-data:/data \
  ghcr.io/fileshed/fileshed:latest
```

The `/data` volume holds the SQLite database (`/data/fileshed.db`), the blob store (`/data/blobs`), and the key that
signs sessions (`/data/auth-secret`), which FileShed generates on the first run. A container started with no
configuration comes up on its own and keeps its sessions across restarts. To supply or rotate the key yourself, see
**[secrets.md](secrets.md)**.

Or with compose — save this as `compose.yaml`:

```yaml
services:
  fileshed:
    image: ghcr.io/fileshed/fileshed:latest
    ports:
      - "3000:3000"
    environment:
      BASE_URL: http://localhost:3000
    volumes:
      - fileshed-data:/data
    restart: unless-stopped

volumes:
  fileshed-data:
```

```bash
docker compose up -d
```

The compose files in the repository (`compose.yaml`, `compose.postgres.yaml`) build the image from source instead;
point them at `ghcr.io/fileshed/fileshed:latest` to run the published one. Both pass `AUTH_SECRET` through from a
`.env` file sitting next to them if you choose to set one — compose reads that file natively, and it must never be
committed.

First run creates the database (migrations run at every boot and are idempotent), then prints a **one-time setup
code** to the container log:

```bash
docker logs fileshed | grep "setup code"
```

Open `/setup` in the browser, enter the code, and create your admin account — the password is typed there and never
lives in an environment or a log. The code regenerates on every boot until setup completes, and the setup page
disappears permanently the moment the first account exists. For non-interactive provisioning, set
`FILESHED_SETUP_TOKEN` and `POST /api/setup` with `{ token, name, email, password }` instead.

### Image tags

Images are published for `linux/amd64` and `linux/arm64`.

| Tag | Points at |
|---|---|
| `latest` | The newest stable release. |
| `beta` | The newest prerelease. |
| `dev` | The newest commit on `main` that passed the full test suite. |
| `0.1.0` | That exact release, permanently. |

Pin the exact version for anything you care about; `latest` and `beta` move under you on every release, and `dev` is
unreleased code.

## Environment

Configuration is layered: the committed `config/config.yaml` holds the defaults with `${VAR:-fallback}` substitution, the
environment variables below flow through it at boot, and admin-set overrides (stored in the database) sit above
both. `FILESHED_CONFIG` points at an alternative yaml file.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AUTH_SECRET` | no | generated on first run | ≥ 32 chars. Signs sessions and encrypts stored instance secrets. Unset, FileShed generates and keeps one at `/data/auth-secret`. **Rotating it signs every user out** — see [secrets.md](secrets.md). |
| `AUTH_SECRET_FILE` | no | `/data/auth-secret` (image) | A file holding that key. Generated when missing at that default path; at any other path it is read-only and a missing one fails the boot. |
| `AUTH_SECRET_PREVIOUS` | no | — | The key being replaced, for the one boot that migrates stored secrets to the new one. |
| `FILESHED_DISCARD_SEALED_SECRETS` | no | `false` | `1` clears stored secrets no available key can open — the only circumstance in which FileShed deletes one. Without it, such a boot refuses. |
| `BASE_URL` | yes | `http://localhost:5173` | The externally reachable URL — behind a proxy, the public one. |
| `TRUSTED_ORIGINS` | no | — | Further origins the instance answers on, comma-separated. See below. |
| `HOST` / `PORT` | no | `0.0.0.0` / `3000` (image) | Bind address and port. |
| `DATABASE_KIND` | no | `sqlite` | `sqlite` or `postgres`. |
| `DATABASE_PATH` | sqlite | `/data/fileshed.db` (image) | SQLite file location. |
| `DATABASE_URL` | postgres | — | `postgres://user:pass@host:5432/fileshed`. |
| `STORAGE_ROOT` | no | `/data/blobs` (image) | Filesystem blob store root. |
| `CLIENT_DIST` | no | `./client-dist` (image) | Built client directory; unset = API-only (development). |
| `UPLOAD_MAX_BYTES` | no | 5 GiB | Single-upload cap. |
| `UPLOAD_CHUNK_BYTES` | no | 8 MiB | Bytes per upload request. Minimum 1 MiB. See below. |
| `AVATAR_MAX_BYTES` | no | 2 MiB | Avatar image cap. |
| `GC_GRACE_DAYS` | no | 7 | Days a dereferenced blob lingers before deletion. |
| `GC_INTERVAL_MINUTES` | no | 60 | Maintenance sweep cadence (GC, trash purge, media-tag backfill). |
| `FILESHED_SETUP_TOKEN` | no | — | Operator-chosen first-run setup token (for automation); omit to use the boot-printed code. |
| `SMTP_HOST` | no | — | Outgoing mail server; unset leaves email off. Also settable in the admin Email tab. |
| `SMTP_PORT` | no | 587 | 587 (STARTTLS) or 465 (TLS). |
| `SMTP_SECURE` | no | `false` | `true` for implicit TLS (port 465). |
| `SMTP_USER` / `SMTP_PASSWORD` | no | — | SMTP credentials; omit for unauthenticated servers. |
| `SMTP_FROM` | no | — | Sender address on outgoing email; required (with `SMTP_HOST`) for email to be on. |
| `EMAIL_VERIFICATION_REQUIRED` | no | `false` | New accounts must verify their address before signing in. Applied at boot. |
| `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET` | no | — | OAuth credentials for any social provider better-auth supports, e.g. `GITHUB_*`, `GOOGLE_*`, `DISCORD_*`. Applied at boot; a provider activates once every field it requires is set. |
| `LOG_LEVEL` | no | `info` | pino levels: trace … silent. |

`TRUSTED_ORIGINS` is for an instance reachable at more than one URL — an internal hostname beside the public one,
split-horizon DNS. List the extra origins comma-separated
(`https://files.example.com,https://files.internal:3950`); each is read down to scheme, host and port, and an entry
that is not an http(s) URL fails the boot with that entry in the message.

A request arriving on a listed origin is answered as that origin: sign-in works there, provider sign-in returns
there, and the links in verification and password-reset email point back at it. A host that is not listed — a stale
DNS name, a forged `Host` header — is answered as `BASE_URL`, which stays the canonical URL and never needs an entry
of its own.

Two things to know:

- Every entry uses the same scheme as `BASE_URL`, and a list mixing them fails the boot. One protocol covers all the
  hosts, and it is also what marks session cookies `Secure`.
- Each origin used for provider sign-in needs its own callback URL registered with that provider —
  `https://files.internal:3950/api/auth/callback/github` alongside the canonical one. How many a provider accepts
  differs: Google, Microsoft and Discord take a list per client, while a GitHub OAuth App takes exactly one, so
  several origins there need a GitHub App or one OAuth app per origin.

A file is uploaded as a sequence of requests rather than one, so the size a reverse proxy has to accept is
`UPLOAD_CHUNK_BYTES`, not the file. The 8 MiB default clears the caps most stacks ship with — nginx starts
`client_max_body_size` at 1 MiB, and Cloudflare's free and pro plans stop at 100 MB. Raise it on a proxy that takes
larger bodies to spend fewer round trips per file. The minimum is 1 MiB, and a smaller value fails the boot naming
the value it read; there is no maximum. A changed value is logged at boot and reaches clients on their next upload —
the server tells each one what to cut its file into.

Everything email can also be configured at runtime from the admin **Email** tab — values set there override these,
the password is stored encrypted, and changes apply to the next email without a restart (except
`EMAIL_VERIFICATION_REQUIRED`, which takes effect on the next one).

Sign-in providers work the same way from the admin **Authentication** tab, which also spells out the callback URL
and the handful of extra fields some providers need (Cognito's pool coordinates, TikTok's client key, Microsoft's
tenant, GitLab's issuer, Apple's bundle identifier — as environment variables: `COGNITO_DOMAIN`, `COGNITO_REGION`,
`COGNITO_USER_POOL_ID`, `TIKTOK_CLIENT_KEY`, `MICROSOFT_TENANT_ID`, `GITLAB_ISSUER`,
`APPLE_APP_BUNDLE_IDENTIFIER`). Provider changes always wait on a restart — better-auth registers its OAuth routes
at boot.

**If custom CSS breaks the UI:** add `?safe-theme` to the URL — say
`https://files.example.com/admin/branding?safe-theme`. The client drops the branding stylesheet before it mounts, so
the page renders stock and you can fix or clear the CSS from the Branding tab; saving applies instance-wide
immediately. Reload without the parameter to get branding back. No shell, no restart.

## Put HTTPS in front

Run FileShed behind a reverse proxy terminating TLS (Caddy, nginx, Traefik). This is not just hygiene — parts of the
app degrade on plain HTTP by browser policy:

- The clipboard API only exists in secure contexts — copy buttons fall back to a legacy path on plain HTTP.
- Casting: AirPlay and (future) Cast receivers fetch media URLs **themselves**, so `BASE_URL` must be reachable from
  those devices, and secure contexts unlock the full casting stack.

Set `BASE_URL` to the public HTTPS URL and forward `Host` / `X-Forwarded-*` headers as usual.

**Proxy logs:** media playback and personal access tokens can ride URLs as `?token=` query parameters. Reverse-proxy
access logs capture query strings by default — treat those logs as sensitive or configure the proxy to redact them.

## Backups

Back up **both, together**:

1. The database — `/data/fileshed.db` (SQLite) or your Postgres database.
2. The blob store — `/data/blobs`.

A `/data` volume backup also carries `/data/auth-secret`, the key that opens the instance secrets stored in the
database. Postgres deployments need it separately: `pg_dump` does not include it. See
**[secrets.md](secrets.md)**.

The database holds the tree, shares, and metadata; the blob store holds the bytes, addressed by content hash. A
backup of one without the other is half a backup: nodes pointing at missing content, or orphaned content no tree
references. Snapshot them from the same moment where possible (stop the container, or use filesystem snapshots).

SQLite runs in WAL mode, so a live instance keeps its most recent commits in a `fileshed.db-wal` sidecar next to the
database file. Copying `fileshed.db` alone while the server is running silently drops them. Stopping the container is
the simplest fix — a clean shutdown folds the WAL back into the database and leaves a single self-contained file. To
back up without stopping, let SQLite take the copy from the host (the image does not carry the `sqlite3` CLI), which
reads the WAL as part of the database:

```bash
sqlite3 /path/to/volume/fileshed.db ".backup '/backup/fileshed.db'"
```

WAL also means SQLite syncs to disk at checkpoints rather than on every commit. An unclean shutdown — a yanked power
cord, not a normal `docker stop` — can cost the last few seconds of committed writes; it cannot corrupt the database.
Postgres deployments are unaffected.

## Postgres

FileShed supports Postgres 17 or newer, which is also the version every release is tested against.

Use the Postgres compose file, which runs the app alongside a Postgres 17 service with a health-checked startup
order:

```bash
docker compose -f compose.postgres.yaml up -d
```

Running your own Postgres instead: set `DATABASE_KIND=postgres` and `DATABASE_URL`, drop `DATABASE_PATH`.
Migrations run at boot against either dialect.

Postgres must be built with ICU support, which FileShed orders names with. A server without it stops the migration at
boot with a message saying so, having changed nothing.

## Listings

A folder listing arrives in chunks of 1,000 items. Up to 50,000 items the client holds the folder whole and sorts and
filters it in the browser. Past that it loads the stretch you are looking at as you scroll, and the server sorts and
filters instead.

Names order identically on both dialects and in the browser. The order is ICU's, at primary strength with numeric
runs: case and accents never separate two names, and `track-9` comes before `track-10`. Postgres orders through a
collation the migrations create. SQLite has no ICU, so the server orders those listings itself and holds one folder's
names in memory to do it — past 100,000 items in a single folder it hands the ordering back to SQLite and names fall
back to alphabetical, where `track-10` precedes `track-9`. Postgres has no such limit.

None of these four numbers are configurable.

## Updating

Pull or rebuild the image and restart. Migrations are additive and run automatically; downgrade paths are not
supported — take a backup before major updates.
