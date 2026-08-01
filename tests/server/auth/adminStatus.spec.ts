//----------------------------------------------------------------------------------------------------------------------
// Admin Route — GET /api/admin/status
//
// The admin diagnostics readout: configured storage backends and the last outcome of each background sweep. Pins the
// authn (401) / authz (403) / success (200) ladder, that a backend row carries id/kind/default but NEVER its config
// blob (which can hold credentials), and that the sweep fields read null until a sweep has run -- then reflect it, fed
// by a real runGcOnce / runTrashPurgeOnce the way the timers feed the tracker in production.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { type AdminStatusResponse, adminStatusResponseCodec } from '@fileshed/core';

// Resource Access
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { NodeManager } from '@server/managers/node.ts';
import { SessionManager } from '@server/managers/session.ts';
import { StatusManager } from '@server/managers/status.ts';
import { runGcOnce } from '@server/managers/gc.ts';
import { runTrashPurgeOnce } from '@server/managers/trashPurge.ts';

// Routes
import { createAdminStatusRoutes } from '@server/routes/admin.ts';

// Support
import { type BootedBlobApp, ORIGIN, bootBlobApp, cookieFrom, signIn, signUp } from '../blobs/support.ts';
import { testNodePolicy } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Deliberately not the real VERSION: the route's job is to carry whatever the manager was built with out to the wire,
// and an assertion against the live constant would hold even if the field were hardcoded downstream.
const INJECTED_VERSION = '7.7.7-route-spec';

let booted : BootedBlobApp;
let tracker : LastRunTracker;

beforeEach(async () =>
{
    booted = await bootBlobApp();
    tracker = new LastRunTracker();

    const sessions = new SessionManager(booted.auth);
    const status = new StatusManager({
        blob: booted.blob,
        nodes: new NodeRA(booted.handle),
        users: new UserRA(booted.handle),
        shares: new ShareRA(booted.handle),
        tracker,
        version: INJECTED_VERSION,
        databaseKind: booted.handle.kind,
        startedAt: new Date(),
        activeProviders: 0,
        emailEnabled: async () => false,
        signUpEnabled: async () => true,
    });

    booted.app.route('/api', createAdminStatusRoutes(sessions, status));
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

function getStatus(cookie ?: string) : Promise<Response>
{
    const headers : Record<string, string> = {};
    if(cookie !== undefined) { headers['cookie'] = cookie; }

    return booted.app.request(`${ ORIGIN }/api/admin/status`, { method: 'GET', headers });
}

async function makeAdminCookie(email : string) : Promise<string>
{
    await signUp(booted.app, email, PASSWORD);
    await booted.handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();

    return cookieFrom(await signIn(booted.app, email, PASSWORD));
}

// Record real (empty-database) sweep summaries the way the timers' onComplete callbacks do in production.
async function recordSweeps() : Promise<void>
{
    const nodeRA = new NodeRA(booted.handle);
    const nodes = new NodeManager(booted.handle, nodeRA, booted.blob, testNodePolicy());

    tracker.recordGc(await runGcOnce({ handle: booted.handle, blob: booted.blob, graceMs: async () => GRACE_MS }));
    tracker.recordTrashPurge(await runTrashPurgeOnce({ nodes: nodeRA, purger: nodes, graceMs: async () => GRACE_MS }));
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/admin/status', () =>
{
    it('rejects an anonymous request with 401', async () =>
    {
        const res = await getStatus();

        expect(res.status).toBe(401);
    });

    it('rejects a signed-in non-admin with 403', async () =>
    {
        await signUp(booted.app, 'member@example.com', PASSWORD);
        const memberCookie = cookieFrom(await signIn(booted.app, 'member@example.com', PASSWORD));

        const res = await getStatus(memberCookie);

        expect(res.status).toBe(403);
    });

    it('reports the configured backends without their config, and null sweeps before any run', async () =>
    {
        const adminCookie = await makeAdminCookie('root@example.com');

        const res = await getStatus(adminCookie);
        const body = await res.json() as AdminStatusResponse;

        expect(res.status).toBe(200);
        expect(body.backends).toEqual([ { id: booted.backendID, kind: 'fs', isDefault: true } ]);
        expect(body.gc).toBeNull();
        expect(body.trashPurge).toBeNull();
    });

    it('reflects the last sweep outcomes once a sweep has run', async () =>
    {
        const adminCookie = await makeAdminCookie('root@example.com');
        await recordSweeps();

        const res = await getStatus(adminCookie);
        const body = await res.json() as AdminStatusResponse;

        expect(res.status).toBe(200);
        expect(body.gc).toEqual({
            ranAt: expect.any(String),
            summary: { candidates: 0, deleted: 0, kept: 0, bytesFailed: 0 },
        });
        expect(body.trashPurge).toEqual({
            ranAt: expect.any(String),
            summary: { candidates: 0, purged: 0, failed: 0 },
        });
        expect(Number.isNaN(Date.parse(body.gc?.ranAt ?? ''))).toBe(false);
    });

    it('carries the overview alongside the backends, counting the admin who asked for it', async () =>
    {
        const adminCookie = await makeAdminCookie('root@example.com');

        const res = await getStatus(adminCookie);
        const body = await res.json() as AdminStatusResponse;

        expect(res.status).toBe(200);
        expect(body.overview.users).toEqual({ total: 1, admins: 1, banned: 0, newThisWeek: 1 });
        expect(body.overview.instance.version).toBe(INJECTED_VERSION);
        expect(body.overview.instance.databaseKind).toBe('sqlite');
    });

    // The client parses this response with the same codec, and it is a strictObject: a field the server adds without
    // the codec knowing, or one the codec requires that the server omits, breaks the admin page at runtime while
    // every shape-agnostic assertion above still passes.
    it('answers a body the shared response codec accepts exactly', async () =>
    {
        const adminCookie = await makeAdminCookie('root@example.com');
        await recordSweeps();

        const body : unknown = await (await getStatus(adminCookie)).json();

        expect(() => adminStatusResponseCodec.parse(body)).not.toThrow();
    });
});

//----------------------------------------------------------------------------------------------------------------------
