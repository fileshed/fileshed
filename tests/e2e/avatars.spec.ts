//----------------------------------------------------------------------------------------------------------------------
// E2E — Avatar lifecycle
//
// The avatar surface over a real socket, a real on-disk SQLite database, and a real filesystem blob store. An upload
// lands content-addressed bytes on disk and points the user row at them; the serve route hands them back with the
// stored mime; a replace or delete graveyards the blob it dropped ONLY when no other user still holds it; and a hash
// that is no longer any user's avatar is refused even while its bytes still linger on disk (the serve gate). Row state
// is read through a second read-only connection; byte state is read straight from the sharded blob tree.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import {
    ApiClient,
    type ServerHandle,
    blobFileExists,
    readBlobFile,
    sha256Of,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;

beforeAll(async () =>
{
    server = await spawnServer();
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

function avatarBytes(seed : string) : Uint8Array
{
    return new TextEncoder().encode(`fileshed-e2e-avatar-${ seed }`);
}

async function signedIn(email : string) : Promise<ApiClient>
{
    const client = new ApiClient(server.baseURL);
    await client.signUp(email, PASSWORD);
    return client;
}

async function avatarShaOf(email : string) : Promise<string | null>
{
    return withDb(server, async (db) =>
    {
        const row = await db.selectFrom('user').select('avatar_sha256')
            .where('email', '=', email)
            .executeTakeFirstOrThrow();
        return row.avatar_sha256;
    });
}

async function blobDeletedAt(sha256 : string) : Promise<string | null>
{
    return withDb(server, async (db) =>
    {
        const row = await db.selectFrom('blob').select('deleted_at')
            .where('sha256', '=', sha256)
            .executeTakeFirst();
        return (row?.deleted_at ?? null) as string | null;
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('avatar upload and serve', () =>
{
    it('stores the bytes on disk, points the user at them, and serves them back with the stored mime', async () =>
    {
        const client = await signedIn('avatar-upload@example.com');
        const bytes = avatarBytes('upload');
        const sha256 = sha256Of(bytes);

        const upload = await client.postBytes('/api/me/avatar', bytes, 'image/png');
        expect(upload.status).toBe(200);
        expect((await upload.json()).image).toBe(`/api/avatars/${ sha256 }`);

        expect(await avatarShaOf('avatar-upload@example.com')).toBe(sha256);
        expect(await blobFileExists(server.storageRoot, sha256)).toBe(true);
        expect(new Uint8Array(await readBlobFile(server.storageRoot, sha256))).toEqual(bytes);

        const me = await client.get('/api/me');
        expect((await me.json()).image).toBe(`/api/avatars/${ sha256 }`);

        const served = await client.get(`/api/avatars/${ sha256 }`);
        expect(served.status).toBe(200);
        expect(served.headers.get('content-type')).toBe('image/png');
        expect(served.headers.get('cache-control')).toBe('private, immutable, max-age=31536000');
        expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
    });

    it('graveyards the blob a replacement drops when nothing else references it', async () =>
    {
        const client = await signedIn('avatar-replace@example.com');
        const first = avatarBytes('replace-first');
        const second = avatarBytes('replace-second');
        const firstSha = sha256Of(first);
        const secondSha = sha256Of(second);

        await client.postBytes('/api/me/avatar', first, 'image/png');
        await client.postBytes('/api/me/avatar', second, 'image/jpeg');

        expect(await avatarShaOf('avatar-replace@example.com')).toBe(secondSha);
        expect(await blobDeletedAt(firstSha)).not.toBeNull();
        expect(await blobDeletedAt(secondSha)).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('shared avatar blobs', () =>
{
    it('keeps a replaced blob alive while another user still holds it as their avatar', async () =>
    {
        const one = await signedIn('avatar-shared-one@example.com');
        const two = await signedIn('avatar-shared-two@example.com');
        const shared = avatarBytes('shared');
        const sharedSha = sha256Of(shared);

        await one.postBytes('/api/me/avatar', shared, 'image/png');
        await two.postBytes('/api/me/avatar', shared, 'image/png');
        await one.postBytes('/api/me/avatar', avatarBytes('shared-moved-on'), 'image/png');

        // User two still references the shared blob, so user one moving on must not graveyard it.
        expect(await blobDeletedAt(sharedSha)).toBeNull();
        expect(await blobFileExists(server.storageRoot, sharedSha)).toBe(true);

        // It is still served, because two's avatar references it.
        const served = await two.get(`/api/avatars/${ sharedSha }`);
        expect(served.status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('avatar delete and the serve gate', () =>
{
    it('clears the profile and refuses the hash once no avatar references it', async () =>
    {
        const client = await signedIn('avatar-delete@example.com');
        const bytes = avatarBytes('delete');
        const sha256 = sha256Of(bytes);
        await client.postBytes('/api/me/avatar', bytes, 'image/png');

        const removed = await client.del('/api/me/avatar');
        expect(removed.status).toBe(204);

        expect(await avatarShaOf('avatar-delete@example.com')).toBeNull();
        expect((await (await client.get('/api/me')).json()).image).toBeNull();

        // The blob is graveyarded, not yet reaped -- its bytes are still on disk. The serve route must still 404 it,
        // because no avatar references the hash anymore: the reference gate, not byte absence, is what refuses it.
        expect(await blobFileExists(server.storageRoot, sha256)).toBe(true);
        const served = await client.get(`/api/avatars/${ sha256 }`);
        expect(served.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
