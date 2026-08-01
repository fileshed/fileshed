//----------------------------------------------------------------------------------------------------------------------
// Node Spec Support
//
// Composes the node/me routes against the real stack the auth harness already boots (real auth, real in-memory SQLite,
// real migrations): a Hono app mounting createNodeRoutes/createMeRoutes with a real SessionManager and NodeManager over
// a real NodeRA, plus the same onError mapping app.ts will wire (mapManagerError). Only the blob-graveyard collaborator
// is a hand-rolled recording double -- it is the RA-boundary seam the node manager reports orphaned blobs to, whose
// real implementation belongs to the upload/GC side.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seedLinkRow builds a snake_case DB row (house convention for Kysely inserts) */

import { Hono } from 'hono';

// Models
import { UNLIMITED_QUOTA } from '@fileshed/core';

// Resource Access
import type { SessionUser } from '@server/resource-access/auth.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Managers
import { NodeManager, type NodePolicy, type OrphanedBlobs } from '@server/managers/node.ts';
import { SessionManager } from '@server/managers/session.ts';
import { mapManagerError } from '@server/managers/errors.ts';

// Routes
import { createNodeRoutes } from '@server/routes/nodes.ts';
import { createSearchRoutes } from '@server/routes/search.ts';
import { createMeRoutes } from '@server/routes/me.ts';

// Support
import type { BootedApp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------
// Orphaned-blob doubles
//----------------------------------------------------------------------------------------------------------------------

// Records every sha batch the manager hands off on a hard delete, so a spec can assert what a delete reported as
// possibly orphaned without a real graveyard implementation.
export class RecordingOrphanedBlobs implements OrphanedBlobs
{
    readonly calls : string[][] = [];

    async graveyardUnreferenced(shas : string[]) : Promise<void>
    {
        this.calls.push(shas);
    }
}

export function noopOrphanedBlobs() : OrphanedBlobs
{
    return { async graveyardUnreferenced() { /* the tree specs do not exercise the graveyard */ } };
}

//----------------------------------------------------------------------------------------------------------------------
// Policy
//----------------------------------------------------------------------------------------------------------------------

// NodeManager demands an instance default rather than assuming one, so the value a spec runs against is stated here
// instead of inside the manager. Specs that care about quota inheritance override it.
export function testNodePolicy(overrides : Partial<NodePolicy> = {}) : NodePolicy
{
    return { defaultQuota: async () => UNLIMITED_QUOTA, ...overrides };
}

//----------------------------------------------------------------------------------------------------------------------
// App composition
//----------------------------------------------------------------------------------------------------------------------

// A single app carrying the auth mount (so signUp/signIn work) plus the node and me surfaces, wired exactly as app.ts
// will wire them at integration -- managers over a real NodeRA, errors mapped through mapManagerError with a 500 floor.
export function composeNodeApp(
    booted : BootedApp,
    orphanedBlobs : OrphanedBlobs = noopOrphanedBlobs(),
    policy : NodePolicy = testNodePolicy()
) : Hono
{
    const sessions = new SessionManager(booted.auth);
    const nodes = new NodeManager(booted.handle, new NodeRA(booted.handle), orphanedBlobs, policy);

    const app = new Hono();

    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => booted.auth.handler(ctx.req.raw));
    app.route('/api', createNodeRoutes(sessions, nodes));
    app.route('/api', createSearchRoutes(sessions, nodes));
    app.route('/api', createMeRoutes(sessions, nodes));

    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped) { return ctx.json(mapped.body, mapped.status); }
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

//----------------------------------------------------------------------------------------------------------------------
// State readers / seeds
//----------------------------------------------------------------------------------------------------------------------

export async function userIDByEmail(booted : BootedApp, email : string) : Promise<string>
{
    const row = await booted.handle.db
        .selectFrom('user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return row.id;
}

// Inserts a link row directly, bypassing the manager's regulation gate. The only way to stage a link whose target the
// placer cannot resolve (a dead link): createLink would reject a foreign, unshared target, but such a link is
// exactly what a revoked share leaves behind. The target and owner rows must already exist (FKs).
export async function seedLinkRow(
    booted : BootedApp,
    init : { id : string; ownerID : string; targetNodeID : string; parentID ?: string | null; name ?: string }
) : Promise<void>
{
    const now = new Date().toISOString();

    await booted.handle.db
        .insertInto('node')
        .values({
            id: init.id,
            type: 'link',
            name: init.name ?? init.id,
            owner_id: init.ownerID,
            parent_id: init.parentID ?? null,
            blob_id: null,
            target_node_id: init.targetNodeID,
            size: null,
            mime_type: null,
            created_at: now,
            updated_at: now,
            trashed_at: null,
        })
        .execute();
}

// Inserts a share grant directly. composeNodeApp mounts no shares surface, so a spec that needs the caller to resolve
// another user's node stages the grant at the row level. The node, grantee, and creator rows must already exist (FKs).
export async function seedShareRow(
    booted : BootedApp,
    init : { nodeID : string; granteeID : string; role : 'viewer' | 'editor'; createdBy : string }
) : Promise<void>
{
    await booted.handle.db
        .insertInto('share')
        .values({
            id: `share_${ init.nodeID }_${ init.granteeID }`,
            node_id: init.nodeID,
            grantee_user_id: init.granteeID,
            role: init.role,
            created_by: init.createdBy,
            created_at: new Date().toISOString(),
        })
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
// Actor double
//----------------------------------------------------------------------------------------------------------------------

interface ActorInit
{
    id : string;
    email ?: string;
    name ?: string;
    role ?: 'admin' | 'user';
    quotaLimit ?: number | null;
    createdAt ?: Date;
}

// A minimal signed-in principal for manager-level specs that drive the manager directly rather than over HTTP. The
// manager reads only id (every method) plus email/name/role/quotaLimit/createdAt (me); the rest of better-auth's
// inferred SessionUser is irrelevant here, so a partial is cast to the boundary type.
export function testActor(init : ActorInit) : SessionUser
{
    const createdAt = init.createdAt ?? new Date('2026-01-01T00:00:00.000Z');

    return {
        id: init.id,
        email: init.email ?? `${ init.id }@t.test`,
        name: init.name ?? init.id,
        role: init.role ?? 'user',
        quotaLimit: init.quotaLimit ?? null,
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
    } as unknown as SessionUser;
}

//----------------------------------------------------------------------------------------------------------------------
