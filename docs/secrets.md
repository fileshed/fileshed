# The session secret

FileShed holds one key of its own. It signs session cookies, and through HKDF-SHA256 it derives the key that
encrypts the instance secrets an admin types into the app — the SMTP password, OAuth client secrets — with
AES-256-GCM. Those values live in the database as ciphertext. The key does not.

Two consequences follow:

- Change the key and every signed-in session ends. Users sign in again.
- Lose the key and the encrypted settings are gone. FileShed says so at boot instead of starting up half-broken.

**FileShed never deletes an encrypted setting on its own.** They are cleared in exactly one circumstance: a boot you
started with `FILESHED_DISCARD_SEALED_SECRETS=1`. Anywhere else that a stored value opens under none of the keys the
boot has, FileShed stops and tells you which settings and what to do — because the key is usually still recoverable,
and the value is not.

## Where it lives

Unless you say otherwise, FileShed keeps the key in a file beside the database and generates it the first time it
starts:

| Deployment | Path |
|---|---|
| Container image | `/data/auth-secret` |
| From source | `./data/auth-secret` |

The file holds one base64 line and is created mode `0600`. In the image it sits on the same `/data` volume as the
database and the blob store, so a backup of that volume already carries it.

## Precedence

Three places can supply the key. The first one that answers wins:

| Order | Source | FileShed's behavior |
|---|---|---|
| 1 | `AUTH_SECRET_FILE`, naming any path but the managed one | Read, never written. A missing or unreadable file fails the boot. |
| 2 | `AUTH_SECRET` — the value itself | Must be at least 32 characters, and not the sample placeholder. |
| 3 | The managed file, whether `AUTH_SECRET_FILE` names it or nothing does | Generated when it is missing. |

Row 3 is how the image works: the Dockerfile sets `AUTH_SECRET_FILE=/data/auth-secret`, which is the managed path,
so a fresh container generates its key there rather than refusing to start.

Supplying the key through row 1 or row 2 takes custody: FileShed re-encrypts the stored settings under the new key
and then deletes the managed file, so the retired key stops sitting next to the data it no longer protects.

## What this protects, and what it does not

Keeping the key out of the database is the whole of the protection.

**It protects a copy of the database that travels on its own:**

- `pg_dump` output and anything downstream of it — replicas, staging refreshes, a dump on a laptop.
- SQL-level access: a read-only credential, a replication stream, a query-level flaw.
- A database-only backup job, including `sqlite3 fileshed.db ".backup ..."`, which copies the database file and
  nothing beside it.

In each of those, the SMTP password and OAuth client secrets are ciphertext, and nothing in the copy opens them.

**It does not protect against:**

- **Theft of the whole `/data` volume or directory.** On the default SQLite deployment the key file and the
  database sit side by side, so whoever takes the volume takes both. This is the common case — the protection above
  is about database copies, not about the volume.
- **A compromised host or container.** The server reads the key and holds it in memory. Root on the box, a shell in
  the container, or a memory dump gets it. Nothing server-side can defend against that, and FileShed does not claim
  to.
- **Whoever can read wherever you put it.** With `AUTH_SECRET`, that means the process environment, your compose
  file, and your shell history. With `AUTH_SECRET_FILE`, the mounted file.
- **The instance's own admins.** FileShed decrypts these values to use them — sending mail, completing an OAuth
  sign-in. The admin API returns them masked (`••••` and the last four characters) and never in full, but an admin
  can overwrite them.

**What a leaked key alone gets an attacker:** the ability to forge anything FileShed signs, session cookies
included. Sessions are served from a short-lived signed cookie that skips the database read, so a forged pair is
accepted on its face — assume account access, up to and including an admin session, and rotate immediately. The
encrypted settings are a separate question: they live in the database, so reading those takes a copy of it as well.
A leaked key **plus** a database copy compromises both at once, and whenever the two could have travelled together,
treat them as one incident.

**If you want stronger custody than a file on the volume:** supply the key yourself, from wherever you already keep
credentials. `AUTH_SECRET_FILE` reads a Docker or Compose secret mounted read-only; `AUTH_SECRET` takes a value
from your secret manager or orchestrator. Both keep the key off the data volume, so a volume backup no longer
carries it — and both still lose to a compromised host, which no server-side design survives.

## Setting up

### A fresh install

Start the container with no secret configured:

```bash
docker run -d --name fileshed -p 3000:3000 -v fileshed-data:/data ghcr.io/fileshed/fileshed:latest
```

The log records what happened:

```
Generated a session-signing secret at '/data/auth-secret', readable only by this user. It is reused on every boot
and belongs in your backups beside the database. Set AUTH_SECRET or AUTH_SECRET_FILE to supply your own instead. See
docs/secrets.md.
```

Nothing else is needed. The file is reused on every later boot.

### Taking control without disrupting anyone

Copy the value FileShed generated into your own configuration. Sessions and stored settings carry on untouched,
because the key has not changed — only who holds it:

```bash
docker exec fileshed cat /data/auth-secret
# put that value in AUTH_SECRET, then restart
```

**What you will see:** one log line, no sign-outs, nothing to re-enter.

```
Removed the managed secret file at '/data/auth-secret': AUTH_SECRET supplies the secret now.
```

### Moving to Docker or Compose secrets

Compose mounts secrets as read-only files, which `AUTH_SECRET_FILE` reads directly:

```yaml
services:
  fileshed:
    image: ghcr.io/fileshed/fileshed:latest
    environment:
      AUTH_SECRET_FILE: /run/secrets/fileshed_auth_secret
    secrets:
      - fileshed_auth_secret

secrets:
  fileshed_auth_secret:
    file: ./auth-secret
```

Seed that file with the key you already have — from `AUTH_SECRET`, or from the managed file — to move custody
without a rotation. Seed it with a fresh `openssl rand -base64 32` to rotate at the same time; FileShed migrates the
stored settings either way.

The file must exist before the container starts. A path of your own is row 1 above — FileShed reads it and creates
nothing there, so a missing mount refuses to boot rather than sign sessions with a key nobody chose:

```
AUTH_SECRET_FILE names '/run/secrets/fileshed_auth_secret', which cannot be read (ENOENT). A file you name is yours:
FileShed reads it and never creates or replaces it. Put the secret there, or unset AUTH_SECRET_FILE to have FileShed
manage one at '/data/auth-secret'. See docs/secrets.md.
```

## Rotating the key

Rotation is one restart. FileShed opens each stored setting with the old key, re-encrypts it under the new one, and
names what it moved. Sessions do not survive — the key that signed them is gone — so every user signs in again,
and that is the only user-visible effect when the migration succeeds.

Which route you take depends on where the old key is.

### From the managed file to `AUTH_SECRET`

The old key is the file FileShed generated, so it can read it itself.

1. Mint a value: `openssl rand -base64 32`.
2. Set `AUTH_SECRET` to it.
3. Restart.

**What you will see:**

```
The session secret changed: re-sealed the stored settings (SMTP_PASSWORD, GITHUB_CLIENT_SECRET) under the new key.
Everyone signed in has been signed out.
Removed the managed secret file at '/data/auth-secret': AUTH_SECRET supplies the secret now.
```

Everyone signs in again. Nothing has to be re-entered in the admin settings. `/data/auth-secret` is gone afterwards.

### From one `AUTH_SECRET` to another

When the key already comes from the environment, FileShed has nothing to migrate from unless you hand it the old
value — and it refuses to start rather than proceed without one. Do one boot with both:

1. Set `AUTH_SECRET` to the new value and `AUTH_SECRET_PREVIOUS` to the one it replaces.

   ```yaml
   environment:
     AUTH_SECRET: <the new value>
     AUTH_SECRET_PREVIOUS: <the value being replaced>
   ```

2. Restart. Confirm the log shows the settings re-sealed:

   ```
   The session secret changed: re-sealed the stored settings (SMTP_PASSWORD) under the new key. Everyone signed in
   has been signed out.
   ```

3. Remove `AUTH_SECRET_PREVIOUS` and restart again.

Everyone signs in again after step 2. Nothing has to be re-entered in the admin settings.

While `AUTH_SECRET_PREVIOUS` stays set with nothing left to migrate, every boot repeats:

```
AUTH_SECRET_PREVIOUS is set and nothing needed it. Remove it from the environment.
```

That warning is the only sign — a lingering `AUTH_SECRET_PREVIOUS` is a copy of a retired key sitting in your
configuration, which is exactly what you rotated to get rid of.

### To or from a file

1. Point `AUTH_SECRET_FILE` at the new file (or drop it, to go back to `AUTH_SECRET`).
2. If the value differs from the one in use, put the old value in `AUTH_SECRET_PREVIOUS` for this boot.
3. Restart, confirm the re-seal line, then remove `AUTH_SECRET_PREVIOUS` and restart again.

Moving from `AUTH_SECRET` to a file holding the same value needs no step 2: FileShed already has both. It tries
keys in this order — the active one, the environment key it displaced, the managed file, then
`AUTH_SECRET_PREVIOUS` — and re-seals with the first that opens each value.

### If you forget the old key

Nothing is lost. A rotation that leaves FileShed unable to open a stored setting ends the boot instead of clearing
anything:

```
Stored settings are encrypted with a key other than the one this boot signs with (SMTP_PASSWORD). This looks like a
rotation without the old key: set AUTH_SECRET_PREVIOUS to the value being replaced and FileShed moves them to the new
key on the next boot. To clear them instead, set FILESHED_DISCARD_SEALED_SECRETS=1 for one boot -- the listed
settings are cleared and have to be re-entered. See docs/secrets.md.
```

Put the old value in `AUTH_SECRET_PREVIOUS` and restart; the rotation completes as described above. A mistyped
`AUTH_SECRET_PREVIOUS` produces the same refusal rather than a loss, so you can keep trying values until one works.

## When FileShed refuses to start

Both refusals mean the same thing: some stored setting is encrypted with a key this boot does not have. Neither one
deletes anything.

### A rotation missing its old key

Covered above under *If you forget the old key*: supply `AUTH_SECRET_PREVIOUS`, or discard as below.

### A restore that forgot the key

The database came back without the file that opens its settings:

```
Stored settings are encrypted with a key this boot does not have (SMTP_PASSWORD). FileShed keeps that key in
'/data/auth-secret' unless AUTH_SECRET or AUTH_SECRET_FILE supplies it: restore that file, or set AUTH_SECRET to the
value that sealed them (adding AUTH_SECRET_PREVIOUS if you are rotating at the same time). To start without them, set
FILESHED_DISCARD_SEALED_SECRETS=1 for one boot -- the listed settings are cleared and have to be re-entered.
```

Three ways forward:

1. **Restore the key.** Put `/data/auth-secret` back from the same backup as the database, and start normally.
2. **Supply it.** Set `AUTH_SECRET` to the value that sealed the settings. Sessions were already lost with the
   restore; the settings are not.
3. **Accept the loss.** See below.

### Discarding what cannot be opened

`FILESHED_DISCARD_SEALED_SECRETS=1` is the only instruction that makes FileShed delete a stored setting. On that one
boot it clears the settings it cannot open, names them, and starts:

```
Cleared stored settings no available key could open (SMTP_PASSWORD, GITHUB_CLIENT_SECRET). Re-enter them in the
admin settings. See docs/secrets.md.
```

Everyone signs in again, and only the encrypted settings are affected — files, users, shares, and links do not depend
on the key. What to re-enter, by name:

| Cleared setting | Where to re-enter it |
|---|---|
| `SMTP_PASSWORD` | Admin → **Email** |
| `<PROVIDER>_CLIENT_SECRET` | Admin → **Authentication**, the provider's client secret field |

Everything else in those tabs — the SMTP host, port, and sender, the OAuth client ids — is stored in the clear and
survives untouched. OAuth provider changes take effect on the next restart, so a re-entered client secret needs one.

Remove the variable afterwards. Left set, it turns the next unopenable setting into a silent deletion, which is the
one thing this design exists to prevent.

## Backups

Back up the key with the data it protects.

**SQLite.** The managed file is inside the data directory, so a `/data` volume backup already includes it. Nothing
extra to do. If you back the database up on its own — `sqlite3 ... ".backup"` into a separate destination — that
copy has no key, and restoring from it alone lands you in the refusal above.

**Postgres.** `pg_dump` does not carry the key. It lives on the app container's filesystem, and a database backup
alone restores to an instance that cannot open its own settings. Either copy `/data/auth-secret` alongside your
dumps or set `AUTH_SECRET` from the same secret store your other credentials come from, and treat that store as the
backup.

Whichever you choose, a backup holding both the key and the database is a full copy of the instance's secrets.
Protect it accordingly.

## What rotation does, and what it cannot undo

Rotating denies the old key any future use: sessions signed with it stop verifying, and stored settings move to the
new key. It changes the lock; it does not take back what the old key already opened. If that key leaked along with a
copy of the database, everything it sealed in that copy was readable the moment both were in hand, and rotating
afterwards does not reach back.

So treat a leaked key as a disclosure of every secret under it. Rotate the key, then rotate those secrets at their
own sources: change the SMTP password at the mail provider, issue new OAuth client secrets, and revoke the old ones.
The rotation here is the first step, not the fix.

## Variables

| Variable | Notes |
|---|---|
| `AUTH_SECRET` | The key itself. At least 32 characters. |
| `AUTH_SECRET_FILE` | A file holding the key. Read-only to FileShed, and a missing file fails the boot — except at the managed path, where it is generated. |
| `AUTH_SECRET_PREVIOUS` | The key being replaced, for one boot, so stored settings move to the new one. |
| `FILESHED_DISCARD_SEALED_SECRETS` | `1` clears settings no available key can open, for one boot. The only circumstance in which FileShed deletes one; without it the boot refuses. |
