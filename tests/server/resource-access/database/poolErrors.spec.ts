//----------------------------------------------------------------------------------------------------------------------
// Database Factory — Postgres pool errors
//
// The proof has to be a separate process. A pool 'error' with no listener throws where nothing is waiting, and a
// vitest worker installs its own uncaught-exception handling -- in here the throw would be reported, out there it ends
// the deployment. So the spec spawns a probe on the real factory (support/poolErrorProbe.ts), kills the backend under
// its idle connection from a second session, and asks the process whether it is still around to answer.
//----------------------------------------------------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';

// Test support
import { testConfig } from '../../auth/support.ts';
import { onAdmin, openTestDatabase, testDatabaseKind } from '../../support/database.ts';
import type { ProbeReply, ProbeRequest } from '../../support/poolErrorProbe.ts';

//----------------------------------------------------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PROBE = join(REPO_ROOT, 'tests/server/support/poolErrorProbe.ts');

// Spawning node over the factory's import graph, provisioning a database, and killing a backend all live inside one
// test; vitest's default budget is too tight for that on a contended run.
const TEST_TIMEOUT_MS = 30_000;

const READY_TIMEOUT_MS = 20_000;
const REPLY_TIMEOUT_MS = 5_000;

// A probe that shuts down on request gives its connection back, which is what lets the suite's reclamation net drop
// the database straight away. SIGKILL is the escape hatch for one that wedged.
const STOP_GRACE_MS = 5_000;

// How long the terminated backend gets to reach the probe. Only a backstop: the wait ends the moment the probe either
// logs the pool error or dies of it, so neither outcome pays this.
const SETTLE_TIMEOUT_MS = 2_000;
const SETTLE_POLL_MS = 20;

// Enough of the handler's message to recognise its log line without spelling the whole thing twice.
const POOL_ERROR_MARKER = 'idle pooled connection';

// pino's numeric level for warn.
const WARN_LEVEL = 40;

// Postgres answers a terminated session with admin_shutdown.
const ADMIN_SHUTDOWN = '57P01';

//----------------------------------------------------------------------------------------------------------------------
// Log records
//----------------------------------------------------------------------------------------------------------------------

interface LogRecord
{
    level : number;
    msg : string;
    code ?: string;
    reason ?: string;
}

function parseRecord(line : string) : LogRecord | undefined
{
    try { return JSON.parse(line) as LogRecord; }
    catch { return undefined; }
}

function poolErrorRecord(logs : string) : LogRecord | undefined
{
    return logs
        .split('\n')
        .map(parseRecord)
        .find((record) => record?.msg.includes(POOL_ERROR_MARKER));
}

//----------------------------------------------------------------------------------------------------------------------
// The probe
//----------------------------------------------------------------------------------------------------------------------

interface Probe
{
    // The backend behind the probe's one pooled connection, parked idle by the time this resolves.
    backendPID : number;

    databaseURL : string;

    alive() : boolean;
    logs() : string;

    // Waits out the terminated backend's trip to the probe. What it found is what alive() and logs() then report.
    settle() : Promise<void>;

    // Round-trips a query through the pool, which has to check a connection out to answer.
    ask() : Promise<boolean>;

    stop() : Promise<void>;
}

//----------------------------------------------------------------------------------------------------------------------

const running = new Set<Probe>();

afterEach(async () =>
{
    const probes = [ ...running ];
    running.clear();

    await Promise.all(probes.map((probe) => probe.stop()));
});

//----------------------------------------------------------------------------------------------------------------------

function withDeadline<TValue>(work : Promise<TValue>, ms : number, what : string) : Promise<TValue>
{
    const expiry = delay(ms).then(() => { throw new Error(`timed out waiting for ${ what }`); });

    return Promise.race([ work, expiry ]);
}

//----------------------------------------------------------------------------------------------------------------------

async function startProbe(databaseURL : string) : Promise<Probe>
{
    const child = spawn(process.execPath, [ PROBE ], {
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            DATABASE_KIND: 'postgres',
            DATABASE_URL: databaseURL,

            // vitest exports vite's own BASE_URL -- '/' -- into the worker environment, and the config schema wants
            // an absolute one. The probe never serves anything; it just has to load a config.
            BASE_URL: 'http://localhost:5173',

            // pino's default level, pinned so the spec reads what an operator sees rather than whatever the shell
            // that started the run happened to set.
            LOG_LEVEL: 'info',

            // Plain JSON on stdout. pino-pretty is a transport worker, and its output is neither parseable nor
            // reliably flushed by a process that is in the middle of dying.
            NODE_ENV: 'production',
        },
        stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
    });

    let stdout = '';
    let stderr = '';
    let exited = false;

    child.stdout?.on('data', (chunk : Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk : Buffer) => { stderr += chunk.toString(); });

    const ended = new Promise<number | null>((resolve) =>
    {
        child.on('exit', (code) => { exited = true; resolve(code); });
    });

    const logs = () : string => stdout;
    const alive = () : boolean => !exited;

    // Resolves on the probe's next reply, and rejects if it dies first -- the crash, reported where a spec can read
    // it rather than as a hung wait.
    const nextReply = () : Promise<ProbeReply> =>
    {
        const replied = once(child, 'message').then(([ message ] : unknown[]) => message as ProbeReply);
        const died = ended.then((code) : never =>
        {
            throw new Error(`the probe exited (${ code }) instead of replying:\n${ stdout }${ stderr }`);
        });

        return Promise.race([ replied, died ]);
    };

    const settleUntil = async (deadline : number) : Promise<void> =>
    {
        if(!alive() || logs().includes(POOL_ERROR_MARKER) || Date.now() >= deadline) { return; }

        await delay(SETTLE_POLL_MS);

        return settleUntil(deadline);
    };

    const send = (request : ProbeRequest) : void => { child.send(request); };

    const ready = await withDeadline(nextReply(), READY_TIMEOUT_MS, 'the probe to open a connection');

    if(ready.kind !== 'ready') { throw new Error(`the probe opened with ${ ready.kind } instead of ready`); }

    const probe : Probe = {
        backendPID: ready.backendPID,
        databaseURL,
        alive,
        logs,
        settle: () => settleUntil(Date.now() + SETTLE_TIMEOUT_MS),

        ask: async () =>
        {
            send('query');

            const answer = await withDeadline(nextReply(), REPLY_TIMEOUT_MS, 'the probe to answer');

            return answer.kind === 'answered' && answer.ok;
        },

        stop: async () =>
        {
            if(!alive()) { return; }

            send('stop');

            try { await withDeadline(ended, STOP_GRACE_MS, 'the probe to exit'); }
            catch
            {
                child.kill('SIGKILL');

                await ended;
            }
        },
    };

    running.add(probe);

    return probe;
}

//----------------------------------------------------------------------------------------------------------------------

// Terminating by the pid the probe reported, and asserting Postgres agreed, keeps the test from passing on a backend
// that was never killed.
async function terminateBackend(backendPID : number) : Promise<void>
{
    await onAdmin(async (client) =>
    {
        const result = await client.query<{ terminated : boolean }>(
            'select pg_terminate_backend(pid) as terminated from pg_stat_activity where pid = $1',
            [ backendPID ]
        );

        expect(result.rows[0]?.terminated).toBe(true);
    });
}

async function probeOnFreshDatabase() : Promise<Probe>
{
    const { config, handle } = await openTestDatabase(testConfig());

    // Kysely opens no connection until something asks it to, and the probe is a whole process away from its first
    // query -- so without this the database sits with nobody attached for as long as a child takes to boot, which is
    // exactly the condition the reclamation net drops on. One query holds a backend open across that window.
    await sql`select 1`.execute(handle.db);

    return startProbe(config.DATABASE_URL ?? '');
}

//----------------------------------------------------------------------------------------------------------------------

describe.runIf(testDatabaseKind() === 'postgres')('createDatabase — Postgres pool errors', () =>
{
    it('outlives a backend terminated under an idle pooled connection, and serves the next query', async () =>
    {
        const probe = await probeOnFreshDatabase();

        await terminateBackend(probe.backendPID);
        await probe.settle();

        expect(probe.alive()).toBe(true);
        expect(await probe.ask()).toBe(true);
    }, TEST_TIMEOUT_MS);

    it('records the dropped connection where an operator watching a flapping database will see it', async () =>
    {
        const probe = await probeOnFreshDatabase();

        await terminateBackend(probe.backendPID);
        await probe.settle();

        const record = poolErrorRecord(probe.logs());

        // warn clears pino's default level without a routine failover reading as a failed request.
        expect(record?.level).toBe(WARN_LEVEL);

        // The two fields a diagnosis starts from: what Postgres said, and the code to look it up by.
        expect(record?.code).toBe(ADMIN_SHUTDOWN);
        expect(record?.reason).toMatch(/terminating connection due to administrator command/i);
    }, TEST_TIMEOUT_MS);

    it('keeps the connection itself out of the log', async () =>
    {
        const probe = await probeOnFreshDatabase();

        await terminateBackend(probe.backendPID);
        await probe.settle();

        // pg-pool hangs the failed client off the error it emits, connection parameters and all, so handing that
        // error to a serializer puts the deployment's database address in every log line.
        const connection = new URL(probe.databaseURL);
        const parts = [ connection.username, connection.password, connection.host ].filter((part) => part !== '');

        expect(parts.length).toBeGreaterThan(0);

        for(const part of parts)
        {
            expect(probe.logs()).not.toContain(part);
        }
    }, TEST_TIMEOUT_MS);
});

//----------------------------------------------------------------------------------------------------------------------
