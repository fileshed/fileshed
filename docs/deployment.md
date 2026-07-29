# Deploying FileShed

FileShed ships as a single container image: one Hono process serves the API and the built web client. SQLite is the
zero-dependency default; Postgres is the primary target for larger deployments.

## Quickstart (Docker)

```bash
docker build -t fileshed .
docker run -d --name fileshed \
  -p 3000:3000 \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BASE_URL=http://localhost:3000 \
  -v fileshed-data:/data \
  fileshed
```

Or with compose. The compose files deliberately contain **no** secret — compose refuses to start until you provide
one, so a deployment can never run on a published placeholder:

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d
```

(The `.env` file sits next to the compose file, is read by compose natively, and must never be committed.)

First run creates the database (migrations run at every boot and are idempotent), then prints a **one-time setup
code** to the container log:

```bash
docker logs fileshed | grep "setup code"
```

Open `/setup` in the browser, enter the code, and create your admin account — the password is typed there and never
lives in an environment or a log. The code regenerates on every boot until setup completes, and the setup page
disappears permanently the moment the first account exists. For non-interactive provisioning, set
`FILESHED_SETUP_TOKEN` and `POST /api/setup` with `{ token, name, email, password }` instead.

## Environment

Configuration is layered: the committed `config/config.yaml` holds the defaults with `${VAR:-fallback}` substitution, the
environment variables below flow through it at boot, and admin-set overrides (stored in the database) sit above
both. `FILESHED_CONFIG` points at an alternative yaml file.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AUTH_SECRET` | **yes** | — | ≥ 32 chars. Signs sessions. **Rotating it signs every user out.** |
| `BASE_URL` | yes | `http://localhost:5173` | The externally reachable URL — behind a proxy, the public one. |
| `HOST` / `PORT` | no | `0.0.0.0` / `3000` (image) | Bind address and port. |
| `DATABASE_KIND` | no | `sqlite` | `sqlite` or `postgres`. |
| `DATABASE_PATH` | sqlite | `/data/fileshed.db` (image) | SQLite file location. |
| `DATABASE_URL` | postgres | — | `postgres://user:pass@host:5432/fileshed`. |
| `STORAGE_ROOT` | no | `/data/blobs` (image) | Filesystem blob store root. |
| `CLIENT_DIST` | no | `./client-dist` (image) | Built client directory; unset = API-only (development). |
| `UPLOAD_MAX_BYTES` | no | 5 GiB | Single-upload cap. |
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
| `LOG_LEVEL` | no | `info` | pino levels: trace … silent. |

Everything email can also be configured at runtime from the admin **Email** tab — values set there override these,
the password is stored encrypted, and changes apply to the next email without a restart (except
`EMAIL_VERIFICATION_REQUIRED`, which takes effect on the next one).

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

The database holds the tree, shares, and metadata; the blob store holds the bytes, addressed by content hash. A
backup of one without the other is half a backup: nodes pointing at missing content, or orphaned content no tree
references. Snapshot them from the same moment where possible (stop the container, or use filesystem snapshots).

## Postgres

Use the Postgres compose file, which runs the app alongside a Postgres 17 service with a health-checked startup
order:

```bash
docker compose -f compose.postgres.yaml up -d
```

Running your own Postgres instead: set `DATABASE_KIND=postgres` and `DATABASE_URL`, drop `DATABASE_PATH`.
Migrations run at boot against either dialect.

## Updating

Pull or rebuild the image and restart. Migrations are additive and run automatically; downgrade paths are not
supported — take a backup before major updates.
