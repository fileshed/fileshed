//----------------------------------------------------------------------------------------------------------------------
// Node Spec Support
//
// The node specs run over the composed app on the auth harness's database. Only the blob-graveyard collaborator is a
// hand-rolled recording double: it is the boundary the node manager reports orphaned blobs to, and its real
// implementation belongs to the upload/GC side.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- seedLinkRow builds a snake_case DB row (house convention for Kysely inserts) */

import type { Hono } from 'hono';

// Models
import { type AccessTokenScope, UNLIMITED_QUOTA, statementForScopes } from '@fileshed/core';

// Resource Access
import type { SessionUser } from '@server/resource-access/auth/instance.ts';

// Managers
import {
    NodeManager,
    type NodePolicy,
    type OrphanedBlobs,
    type OrphanedBlobsFor,
} from '@server/managers/node.ts';
import type { Actor } from '@server/managers/session.ts';

// App
import { createApp } from '@server/clients/http/app.ts';
import type { AppServices } from '@server/services.ts';

// Support
import { type BootedApp, composeTestServices } from '../auth/support.ts';

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

export function noopOrphanedBlobs() : OrphanedBlobsFor
{
    return () => ({ async graveyardUnreferenced() { /* the tree specs do not exercise the graveyard */ } });
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

// The composed app with one swap: a NodeManager reporting orphaned blobs to the given collaborator under the given
// policy, so a spec can see what a delete handed off without a real graveyard behind it.
export function composeNodeApp(
    booted : BootedApp,
    orphanedBlobs : OrphanedBlobsFor = noopOrphanedBlobs(),
    policy : NodePolicy = testNodePolicy()
) : Hono
{
    const services : AppServices = {
        ...composeTestServices(booted.auth, booted.handle, booted.config),
        nodes: new NodeManager({ handle: booted.handle, orphanedBlobs, policy }),
    };

    return createApp({ auth: booted.auth, services });
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
    createdAt ?: Date;
}

// A minimal signed-in principal for manager-level specs that drive the manager directly rather than over HTTP. The
// manager reads only id (every method) plus email/name/role/createdAt (me); the rest of better-auth's inferred
// SessionUser is irrelevant here, so a partial is cast to the boundary type.
//
// Deliberately carries no quota: a session cannot state one. Quota is read from the user row at every enforcement
// point, so a spec that needs a capped actor seeds the cap on the row (seedUser/setUserQuota) -- an actor-shaped
// knob here would let a spec "set" a quota that nothing enforces.
export function testActor(init : ActorInit) : SessionUser
{
    const createdAt = init.createdAt ?? new Date('2026-01-01T00:00:00.000Z');

    return {
        id: init.id,
        email: init.email ?? `${ init.id }@t.test`,
        name: init.name ?? init.id,
        role: init.role ?? 'user',
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
    } as unknown as SessionUser;
}

// The signed-in browser plane, for the reads that take a whole Actor: a session carries no permission statement,
// which is exactly what makes it the unrestricted one.
export function testSession(init : ActorInit) : Actor
{
    return { kind: 'session', user: testActor(init) };
}

// A key-bearing caller with an explicit statement, for the reads whose disclosure depends on the key's scopes.
export function testToken(init : ActorInit, scopes : readonly AccessTokenScope[]) : Actor
{
    return { kind: 'token', user: testActor(init), permissions: statementForScopes(scopes) };
}

//----------------------------------------------------------------------------------------------------------------------
