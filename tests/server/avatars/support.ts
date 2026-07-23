//----------------------------------------------------------------------------------------------------------------------
// Avatar Spec Support
//
// Boots the real avatar slice end to end: a fresh in-memory database (real factory + migrations + admin bootstrap), a
// real BlobRA over an fs facade under a per-run temp directory, the real AvatarManager and NodeManager, and a Hono app
// mounting the real auth handler alongside the avatar and me routes. onError routes through mapManagerError, the same
// translation the integrated app uses -- so specs drive the flow with app.request and read state through the real
// handle and storage RA, zero mocks.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- reads/writes name snake_case DB columns (house convention for Kysely) */

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { Hono } from 'hono';

// Resource Access
import { type Auth, createAuth } from '@server/resource-access/auth.ts';
import { BlobNotFoundError, BlobRA } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { initialize } from '@server/resource-access/boot.ts';

// Managers
import { AvatarManager } from '@server/managers/avatar.ts';
import { NodeManager } from '@server/managers/node.ts';
import { SessionManager } from '@server/managers/session.ts';
import { mapManagerError } from '@server/managers/errors.ts';

// Routes
import { createAvatarRoutes } from '@server/routes/avatars.ts';
import { createMeRoutes } from '@server/routes/me.ts';

// Auth support (real sign-up/sign-in over the same app)
import { ORIGIN, cookieFrom, signIn, signUp, testConfig } from '../auth/support.ts';

export { ORIGIN } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BootedAvatarApp
{
    app : Hono;
    handle : DatabaseHandle;
    auth : Auth;
    blob : BlobRA;
    backendID : string;
    avatars : AvatarManager;
    storageRoot : string;
    cleanup : () => Promise<void>;
}

function composeApp(auth : Auth, avatars : AvatarManager, nodes : NodeManager) : Hono
{
    const app = new Hono();
    const sessions = new SessionManager(auth);

    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
    app.route('/api', createAvatarRoutes(sessions, avatars, nodes));
    app.route('/api', createMeRoutes(sessions, nodes));

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));
    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped) { return ctx.json(mapped.body, mapped.status); }
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

export async function bootAvatarApp(avatarMaxBytes ?: number) : Promise<BootedAvatarApp>
{
    const storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-avatar-'));
    const overrides = avatarMaxBytes === undefined ? {} : { AVATAR_MAX_BYTES: avatarMaxBytes };
    const config = testConfig({ STORAGE_ROOT: storageRoot, ...overrides });

    const handle = createDatabase(config);
    const auth = createAuth(handle, config);
    await initialize(handle, auth, config);

    const backendID = await seedDefaultBackend(handle, config);
    const blob = new BlobRA(handle);
    const avatars = new AvatarManager({ handle, blob, avatarMaxBytes: config.AVATAR_MAX_BYTES });
    const nodes = new NodeManager(handle, new NodeRA(handle), blob);

    return {
        app: composeApp(auth, avatars, nodes),
        handle,
        auth,
        blob,
        backendID,
        avatars,
        storageRoot,
        cleanup: async () =>
        {
            await handle.db.destroy();
            await rm(storageRoot, { recursive: true, force: true });
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
// Users
//----------------------------------------------------------------------------------------------------------------------

export interface TestUser
{
    id : string;
    cookie : string;
    email : string;
}

export async function makeUser(booted : BootedAvatarApp, email : string) : Promise<TestUser>
{
    const password = 'correct-horse-battery';
    await signUp(booted.app, email, password);

    const cookie = cookieFrom(await signIn(booted.app, email, password));
    const row = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie, email };
}

//----------------------------------------------------------------------------------------------------------------------
// HTTP helpers
//----------------------------------------------------------------------------------------------------------------------

export function postAvatar(app : Hono, cookie : string, bytes : Buffer, contentType : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me/avatar`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie },
        body: new Uint8Array(bytes),
    });
}

export function deleteAvatar(app : Hono, cookie : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me/avatar`, { method: 'DELETE', headers: { cookie } });
}

export function getAvatar(app : Hono, cookie : string, sha256 : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/avatars/${ sha256 }`, { headers: { cookie } });
}

export function getMe(app : Hono, cookie : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me`, { headers: { cookie } });
}

//----------------------------------------------------------------------------------------------------------------------
// Fixtures + state readers
//----------------------------------------------------------------------------------------------------------------------

export function sha256Of(bytes : Buffer) : string
{
    return createHash('sha256')
        .update(bytes)
        .digest('hex');
}

// Store bytes through the real RA and record their blob row, with no avatar or node pointing at them. The seam the
// serve-gate spec needs: a blob that genuinely exists in the dedup store yet is nobody's avatar.
export async function seedUnreferencedBlob(booted : BootedAvatarApp, bytes : Buffer) : Promise<string>
{
    const sha256 = sha256Of(bytes);
    const location = await booted.blob.put(sha256, Readable.from(bytes), bytes.length);

    await booted.handle.db
        .insertInto('blob')
        .values({
            sha256,
            size: bytes.length,
            backend_id: location.backendID,
            storage_key: location.storageKey,
            created_at: new Date().toISOString(),
            deleted_at: null,
        })
        .execute();

    return sha256;
}

export interface AvatarRow
{
    avatar_sha256 : string | null;
    avatar_mime : string | null;
}

export async function avatarRow(booted : BootedAvatarApp, userID : string) : Promise<AvatarRow>
{
    return booted.handle.db
        .selectFrom('user')
        .select([ 'avatar_sha256', 'avatar_mime' ])
        .where('id', '=', userID)
        .executeTakeFirstOrThrow();
}

async function collect(stream : Readable) : Promise<Buffer>
{
    const chunks : Buffer[] = [];
    for await (const chunk of stream) { chunks.push(chunk as Buffer); }
    return Buffer.concat(chunks);
}

export async function bytesExist(booted : BootedAvatarApp, sha256 : string) : Promise<boolean>
{
    try
    {
        await collect(await booted.blob.getStream({ backendID: booted.backendID, storageKey: sha256 }));
        return true;
    }
    catch(error)
    {
        if(error instanceof BlobNotFoundError) { return false; }
        throw error;
    }
}

// The GC graveyard marker for a blob: null when live, a timestamp once its last reference is gone.
export async function blobDeletedAt(booted : BootedAvatarApp, sha256 : string) : Promise<Date | string | null>
{
    const row = await booted.handle.db
        .selectFrom('blob')
        .select('deleted_at')
        .where('sha256', '=', sha256)
        .executeTakeFirstOrThrow();
    return row.deleted_at;
}

export async function blobRowExists(booted : BootedAvatarApp, sha256 : string) : Promise<boolean>
{
    const row = await booted.handle.db
        .selectFrom('blob')
        .select('sha256')
        .where('sha256', '=', sha256)
        .executeTakeFirst();
    return row !== undefined;
}

//----------------------------------------------------------------------------------------------------------------------
