//----------------------------------------------------------------------------------------------------------------------
// Avatar Spec Support
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- reads/writes name snake_case DB columns (house convention for Kysely) */

import { Readable } from 'node:stream';

import type { Hono } from 'hono';

// Models
import { BlobNotFoundError } from '@fileshed/core';

// Support
import { sha256Of } from '../support/sha256.ts';
import { ORIGIN, cookieFrom, signIn, signUp } from '../auth/support.ts';
import type { BootedStoreApp } from '../support/storeApp.ts';

export { ORIGIN } from '../auth/support.ts';
export { type BootedStoreApp, bootStoreApp } from '../support/storeApp.ts';

//----------------------------------------------------------------------------------------------------------------------
// Users
//----------------------------------------------------------------------------------------------------------------------

export interface TestUser
{
    id : string;
    cookie : string;
    email : string;
}

export async function makeUser(booted : BootedStoreApp, email : string) : Promise<TestUser>
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

export async function postAvatar(app : Hono, cookie : string, bytes : Buffer, contentType : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me/avatar`, {
        method: 'POST',
        headers: { 'content-type': contentType, cookie },
        body: new Uint8Array(bytes),
    });
}

export async function deleteAvatar(app : Hono, cookie : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me/avatar`, { method: 'DELETE', headers: { cookie } });
}

export async function getAvatar(app : Hono, cookie : string, sha256 : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/avatars/${ sha256 }`, { headers: { cookie } });
}

export async function getMe(app : Hono, cookie : string) : Promise<Response>
{
    return app.request(`${ ORIGIN }/api/me`, { headers: { cookie } });
}

//----------------------------------------------------------------------------------------------------------------------
// Fixtures + state readers
//----------------------------------------------------------------------------------------------------------------------

// Store bytes through the real RA and record their blob row, with no avatar or node pointing at them. The seam the
// serve-gate spec needs: a blob that genuinely exists in the dedup store yet is nobody's avatar.
export async function seedUnreferencedBlob(booted : BootedStoreApp, bytes : Buffer) : Promise<string>
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
            created: new Date().toISOString(),
            deleted: null,
        })
        .execute();

    return sha256;
}

export interface AvatarRow
{
    avatar_sha256 : string | null;
    avatar_mime : string | null;
}

export async function avatarRow(booted : BootedStoreApp, userID : string) : Promise<AvatarRow>
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

export async function bytesExist(booted : BootedStoreApp, sha256 : string) : Promise<boolean>
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
export async function blobDeletedAt(booted : BootedStoreApp, sha256 : string) : Promise<Date | string | null>
{
    const row = await booted.handle.db
        .selectFrom('blob')
        .select('deleted')
        .where('sha256', '=', sha256)
        .executeTakeFirstOrThrow();
    return row.deleted;
}

export async function blobRowExists(booted : BootedStoreApp, sha256 : string) : Promise<boolean>
{
    const row = await booted.handle.db
        .selectFrom('blob')
        .select('sha256')
        .where('sha256', '=', sha256)
        .executeTakeFirst();
    return row !== undefined;
}

//----------------------------------------------------------------------------------------------------------------------
