//----------------------------------------------------------------------------------------------------------------------
// End-to-End Harness
//
// Boots FileShed the way production does -- `node src/server/server.ts` as a real child process, listening on a real
// socket, over a real on-disk SQLite database and a real filesystem blob store. Tests drive it with `fetch` and a
// cookie jar, then read back state two ways the running server does not mediate: a second, read-only SQLite connection
// to the same file (row assertions) and direct reads of the sharded blob tree (byte assertions). Nothing here uses
// app.request or an in-process app -- the whole point is to catch what only surfaces across a process and a socket.
//
// Port strategy: the serve config rejects PORT=0 (config.ts requires a positive int), so the harness binds port 0
// itself, reads the ephemeral port the OS assigns, closes the probe, and hands that port to the child. The close/spawn
// gap is a race another process could theoretically win; a child that loses it exits on EADDRINUSE, which waitForHealth
// surfaces with the captured stderr rather than hanging. Each spec file gets its own port and its own temp dirs, so
// files parallelize safely.
//
// No orphaned processes: stop() terminates the child (SIGTERM, then SIGKILL) and removes the temp dirs; a process-exit
// hook SIGKILLs any child still tracked, covering a spec that throws before afterAll or a worker torn down mid-run.
//
// Restarts: stop({ keep: true }) leaves the directories behind and spawnServer({ dirs }) boots a second child straight
// onto them, which is how a spec drives state that only survives a real restart. Whoever stops last without `keep`
// removes them -- the pair outlives any single child, so the spec, not the harness, decides when they go.
//----------------------------------------------------------------------------------------------------------------------

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { Kysely } from 'kysely';
import { NodeSqliteDialect } from '@fileshed/kysely-node-sqlite';

// Constants
import { SMALL_FILE_THRESHOLD_BYTES, SQLITE_BUSY_TIMEOUT_MS } from '@fileshed/core';

// Database row schema (types only -- the inspector reads the same tables the server writes)
import type { Database } from '@server/resource-access/database/database.ts';

// The proof-of-possession answer, computed the way a possessing client would. Single source of truth for the HMAC,
// shared with the in-process blob-flow specs rather than reimplemented here.
export { computeAnswer } from '../server/blobs/support.ts';

//----------------------------------------------------------------------------------------------------------------------
// Spawn configuration
//----------------------------------------------------------------------------------------------------------------------

// tests/e2e/support.ts -> repo root is two directories up. The production entry lives under src/server.
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER_ENTRY = join(REPO_ROOT, 'src/server/server.ts');

// The child stages its database and blobs here; both are removed on stop().
const DATABASE_FILENAME = 'fileshed.db';

// Boot budget: migrations (better-auth's introspecting migrator + the app migrations), the seed, and optionally the
// admin bootstrap all run before the socket answers. Generous so a cold, contended run does not flake.
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 100;

// SIGTERM grace before the harness escalates to SIGKILL.
const SIGKILL_GRACE_MS = 3_000;

// Meets the config schema's 32-character minimum; a fixed value keeps sessions verifiable across a single child's life.
const AUTH_SECRET = 'e2e-test-auth-secret-0123456789-abcdef';

//----------------------------------------------------------------------------------------------------------------------
// Orphan guard
//----------------------------------------------------------------------------------------------------------------------

const activeChildren = new Set<ChildProcessWithoutNullStreams>();

// A last-resort synchronous sweep: if the worker exits with a child still tracked (a spec threw before afterAll, or the
// worker was torn down), SIGKILL it so no server outlives the run. The happy path empties the set in stop().
process.once('exit', () =>
{
    for(const child of activeChildren)
    {
        try { child.kill('SIGKILL'); }
        catch { /* already gone */ }
    }
});

//----------------------------------------------------------------------------------------------------------------------
// Server handle
//----------------------------------------------------------------------------------------------------------------------

// The pair of directories one server's state lives in: the SQLite database's home and the root of the blob tree.
export interface ServerDirs
{
    dataDir : string;
    storageRoot : string;
}

export interface ServerHandle
{
    baseURL : string;
    dataDir : string;
    databasePath : string;
    storageRoot : string;
    stop(options ?: StopOptions) : Promise<void>;
}

export interface SpawnOptions
{
    // Extra environment for the child -- e.g. FILESHED_SETUP_TOKEN to exercise the first-run setup flow.
    env ?: Record<string, string>;

    // Boot over an existing server's state instead of fresh temp dirs, for a spec that restarts a server.
    dirs ?: ServerDirs;

    // Command-line arguments for the child. The interactive API reference is reachable only this way, which is what
    // keeps it out of a deployment, so a spec that wants it has to ask exactly as a developer would.
    args ?: string[];
}

export interface StopOptions
{
    // Leave the directories in place for a later spawn to reuse. The caller owns them from then on.
    keep ?: boolean;
}

// Ask the OS for a free port by binding 0 on the loopback, then hand it back once the probe is closed.
function reserveFreePort() : Promise<number>
{
    return new Promise((resolve, reject) =>
    {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () =>
        {
            const address = probe.address();
            if(address === null || typeof address === 'string')
            {
                probe.close(() => reject(new Error('Could not determine a free port.')));
                return;
            }

            const { port } = address;
            probe.close(() => resolve(port));
        });
    });
}

async function probeHealth(baseURL : string) : Promise<boolean>
{
    try
    {
        const res = await fetch(`${ baseURL }/api/health`);
        return res.status === 200;
    }
    catch { return false; }
}

// Poll GET /api/health until it answers 200, or fail with the child's captured output so a boot failure is diagnosable
// from the test log rather than a bare timeout. A child that has already exited fails fast -- there is nothing to wait
// for. The poll recurses rather than loops, so the sequential awaits stay clear of no-await-in-loop.
async function waitForHealth(
    baseURL : string,
    exitOf : () => { code : number | null; signal : NodeJS.Signals | null } | null,
    stderrOf : () => string,
    stdoutOf : () => string
) : Promise<void>
{
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;

    const failWith = (reason : string) : never =>
    {
        const detail = [
            reason,
            `--- server stderr ---\n${ stderrOf() || '(empty)' }`,
            `--- server stdout ---\n${ stdoutOf() || '(empty)' }`,
        ].join('\n');
        throw new Error(detail);
    };

    async function attempt() : Promise<void>
    {
        const exit = exitOf();
        if(exit !== null)
        {
            failWith(`Server exited before becoming healthy (code=${ exit.code }, signal=${ exit.signal }).`);
        }

        if(await probeHealth(baseURL)) { return; }

        if(Date.now() >= deadline)
        {
            failWith(`Server did not answer /api/health within ${ HEALTH_TIMEOUT_MS }ms.`);
        }

        await delay(HEALTH_POLL_MS);
        return attempt();
    }

    return attempt();
}

// SIGTERM, then SIGKILL if the child outlives the grace window. Resolves once the process is gone (or was already).
function terminate(child : ChildProcessWithoutNullStreams) : Promise<void>
{
    if(child.exitCode !== null || child.signalCode !== null) { return Promise.resolve(); }

    return new Promise((resolve) =>
    {
        const escalation = globalThis.setTimeout(() =>
        {
            try { child.kill('SIGKILL'); }
            catch { /* already gone */ }
        }, SIGKILL_GRACE_MS);

        child.once('exit', () =>
        {
            globalThis.clearTimeout(escalation);
            resolve();
        });

        child.kill('SIGTERM');
    });
}

export async function spawnServer(options : SpawnOptions = {}) : Promise<ServerHandle>
{
    const port = await reserveFreePort();
    const baseURL = `http://127.0.0.1:${ port }`;

    const dataDir = options.dirs?.dataDir ?? await mkdtemp(join(tmpdir(), 'fileshed-e2e-db-'));
    const storageRoot = options.dirs?.storageRoot ?? await mkdtemp(join(tmpdir(), 'fileshed-e2e-blobs-'));
    const databasePath = join(dataDir, DATABASE_FILENAME);

    const child = spawn(process.execPath, [ SERVER_ENTRY, ...options.args ?? [] ], {
        cwd: REPO_ROOT,
        stdio: [ 'ignore', 'pipe', 'pipe' ],
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            BASE_URL: baseURL,
            DATABASE_KIND: 'sqlite',
            DATABASE_PATH: databasePath,
            STORAGE_ROOT: storageRoot,
            AUTH_SECRET,
            // Errors only by default, so a crashed boot still says why in the captured stderr; raise it with
            // E2E_LOG_LEVEL=debug when a spec needs the server's side of the story.
            LOG_LEVEL: process.env['E2E_LOG_LEVEL'] ?? 'error',
            // Every child sees one client, so a spec that signs in a dozen times would spend a real deployment's
            // credential budget on setup. Raised rather than disabled, and set before the spread so a spec proving
            // the limiter can still tighten them back down.
            RATE_LIMIT_CREDENTIALS_MAX: '1000',
            RATE_LIMIT_MAX: '100000',
            RATE_LIMIT_ANONYMOUS_MAX: '100000',
            ...options.env,
        },
    });

    activeChildren.add(child);

    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });

    let exit : { code : number | null; signal : NodeJS.Signals | null } | null = null;
    child.once('exit', (code, signal) =>
    {
        exit = { code, signal };
        activeChildren.delete(child);
    });

    const handle : ServerHandle = {
        baseURL,
        dataDir,
        databasePath,
        storageRoot,
        stop: async ({ keep = false } : StopOptions = {}) =>
        {
            await terminate(child);
            if(keep) { return; }

            await rm(dataDir, { recursive: true, force: true });
            await rm(storageRoot, { recursive: true, force: true });
        },
    };

    try
    {
        await waitForHealth(baseURL, () => exit, () => stderr, () => stdout);
    }
    catch(error)
    {
        // A failed boot still tears the child down, but never takes directories the caller handed in with it -- they
        // are the caller's to keep, and a spec inspecting why the restart failed needs them intact.
        await handle.stop({ keep: options.dirs !== undefined });
        throw error;
    }

    return handle;
}

//----------------------------------------------------------------------------------------------------------------------
// API client
//
// A fetch wrapper with a cookie jar: it captures every Set-Cookie the server sends and replays them, so real session
// cookies (better-auth's signed token plus its cookie-cache companion) travel like a browser's would. Every request
// carries an Origin matching the server's BASE_URL -- better-auth's CSRF check trusts that origin, and Node's fetch
// sends no Origin on its own.
//----------------------------------------------------------------------------------------------------------------------

export class ApiClient
{
    readonly #baseURL : string;
    readonly #cookies = new Map<string, string>();

    constructor(baseURL : string)
    {
        this.#baseURL = baseURL;
    }

    async signUp(email : string, password : string, name = 'E2E User') : Promise<Response>
    {
        return this.post('/api/auth/sign-up/email', { email, name, password });
    }

    async signIn(email : string, password : string) : Promise<Response>
    {
        return this.post('/api/auth/sign-in/email', { email, password });
    }

    async get(path : string) : Promise<Response>
    {
        return this.#request('GET', path, {});
    }

    // Omitting the body sends a POST with no body and no content-type at all, the way an endpoint that takes none is
    // actually called.
    async post(path : string, body ?: unknown) : Promise<Response>
    {
        if(body === undefined) { return this.#request('POST', path, {}); }

        return this.#request('POST', path, {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    async patch(path : string, body : unknown) : Promise<Response>
    {
        return this.#request('PATCH', path, {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    async put(path : string, bytes : Uint8Array, contentType = 'application/octet-stream') : Promise<Response>
    {
        return this.#request('PUT', path, {
            headers: { 'content-type': contentType },
            body: bytes,
        });
    }

    // A PUT whose body is produced as it goes rather than handed over whole, and which the caller can cut off partway
    // through -- the only way to drive a request that dies mid-flight over a real socket.
    async putStream(path : string, body : ReadableStream<Uint8Array>, signal : AbortSignal) : Promise<Response>
    {
        return this.#request('PUT', path, {
            headers: { 'content-type': 'application/octet-stream' },
            body,
            duplex: 'half',
            signal,
        } as RequestInit);
    }

    async postBytes(path : string, bytes : Uint8Array, contentType : string) : Promise<Response>
    {
        return this.#request('POST', path, {
            headers: { 'content-type': contentType },
            body: bytes,
        });
    }

    async del(path : string) : Promise<Response>
    {
        return this.#request('DELETE', path, {});
    }

    async #request(method : string, path : string, init : RequestInit) : Promise<Response>
    {
        const headers = new Headers(init.headers);
        headers.set('origin', this.#baseURL);

        const cookie = [ ...this.#cookies.values() ].join('; ');
        if(cookie !== '') { headers.set('cookie', cookie); }

        const res = await fetch(this.#baseURL + path, { ...init, method, headers });
        this.#capture(res);

        return res;
    }

    #capture(res : Response) : void
    {
        for(const raw of res.headers.getSetCookie())
        {
            const pair = raw.split(';', 1)[0] ?? '';
            const eq = pair.indexOf('=');

            if(eq > 0)
            {
                const name = pair.slice(0, eq);
                const value = pair.slice(eq + 1);

                // An empty value is the server clearing the cookie (sign-out, rotation) -- drop it from the jar.
                if(value === '') { this.#cookies.delete(name); }
                else { this.#cookies.set(name, pair); }
            }
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Fixtures
//----------------------------------------------------------------------------------------------------------------------

export function sha256Of(data : Uint8Array) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Deterministic content of a given size: the seed tiled to fill the buffer. Deterministic so a rerun addresses the same
// blob, and so two callers asking for the same seed+size get byte-identical content the store will dedup.
function deterministicBytes(size : number, seed : string) : Buffer
{
    const unit = Buffer.from(seed);
    const buffer = Buffer.alloc(size);
    for(let offset = 0; offset < size; offset += unit.length)
    {
        unit.copy(buffer, offset);
    }
    return buffer;
}

// A small file (well under the threshold): a known blob at this size is re-uploaded, never challenged.
export function smallFixture(seed = 'fileshed-e2e-small') : Buffer
{
    return deterministicBytes(64 * 1024, seed);
}

// A large file (over the threshold): a known blob at this size triggers a proof-of-possession challenge.
export function largeFixture(seed = 'fileshed-e2e-large') : Buffer
{
    return deterministicBytes(SMALL_FILE_THRESHOLD_BYTES + 4096, seed);
}

//----------------------------------------------------------------------------------------------------------------------
// Database inspector
//
// A read-only Kysely handle on the very SQLite file the child is writing. Row assertions read committed state the
// server never hands back over HTTP (blob backend pins, graveyard markers, orphaned rows). A busy timeout absorbs the
// brief window a writer holds the file, though inspections run after their HTTP response has already committed.
//----------------------------------------------------------------------------------------------------------------------

export interface DbInspector
{
    db : Kysely<Database>;
    close() : Promise<void>;
}

export function openDb(databasePath : string) : DbInspector
{
    const dialect = new NodeSqliteDialect({
        location: databasePath,
        readOnly: true,
        timeout: SQLITE_BUSY_TIMEOUT_MS,
    });

    const db = new Kysely<Database>({ dialect });

    return { db, close: () => db.destroy() };
}

// Open a fresh read-only connection, run one set of reads, and close it -- so every inspection sees the latest
// committed state and leaves no handle open on the file. The path comes off the handle, which is the one place the
// child's DATABASE_PATH is decided.
export async function withDb<T>(server : ServerHandle, read : (db : Kysely<Database>) => Promise<T>) : Promise<T>
{
    const inspector = openDb(server.databasePath);
    try { return await read(inspector.db); }
    finally { await inspector.close(); }
}

//----------------------------------------------------------------------------------------------------------------------
// Blob store inspector
//
// The fs backend keys blobs at root/ab/cd/<sha256>, sharded by the first two byte-pairs of the hash (fsBackend.ts). A
// committed upload lands there; the staging area holds bytes only mid-write, so a rejected upload must leave it empty.
//----------------------------------------------------------------------------------------------------------------------

export function blobPath(storageRoot : string, sha256 : string) : string
{
    return join(storageRoot, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

export async function blobFileExists(storageRoot : string, sha256 : string) : Promise<boolean>
{
    try
    {
        await access(blobPath(storageRoot, sha256));
        return true;
    }
    catch { return false; }
}

export async function readBlobFile(storageRoot : string, sha256 : string) : Promise<Buffer>
{
    return readFile(blobPath(storageRoot, sha256));
}

// The names left in the fs backend's staging directory. Empty after any completed or rejected upload -- a lingering
// staging file is orphaned bytes.
export async function stagedFiles(storageRoot : string) : Promise<string[]>
{
    return readdir(join(storageRoot, '.staging')).catch(() => []);
}

//----------------------------------------------------------------------------------------------------------------------
