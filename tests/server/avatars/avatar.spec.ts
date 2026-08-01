//----------------------------------------------------------------------------------------------------------------------
// Avatars — upload, delete, serve, and GC interaction
//
// Drives the avatar slice over the real stack (real auth, in-memory SQLite, fs blob backend), zero mocks. Every
// expectation is the contract: an upload stores content-addressed bytes and points the user at them; a replace or
// delete graveyards the blob it dropped ONLY when nothing else references it; the serve route hands back bytes with the
// stored mime and an immutable cache, but only for a hash some avatar actually references; and GC never reaps a blob an
// avatar still holds.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- avatar-row assertions name snake_case DB columns (house convention for Kysely) */

import { afterEach, describe, expect, it } from 'vitest';

// Managers
import { runGcOnce } from '@server/managers/gc.ts';

// Support
import {
    type BootedAvatarApp,
    avatarRow,
    blobDeletedAt,
    blobRowExists,
    bootAvatarApp,
    bytesExist,
    deleteAvatar,
    getAvatar,
    getMe,
    makeUser,
    postAvatar,
    seedUnreferencedBlob,
    sha256Of,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const cleanups : (() => Promise<void>)[] = [];

async function boot(avatarMaxBytes ?: number) : Promise<BootedAvatarApp>
{
    const booted = await bootAvatarApp(avatarMaxBytes);
    cleanups.push(booted.cleanup);
    return booted;
}

afterEach(async () =>
{
    await Promise.all(cleanups.map((cleanup) => cleanup()));
    cleanups.length = 0;
});

//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/me/avatar', () =>
{
    it('stores the bytes content-addressed and points the user at them', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('an avatar image, pretend it is a PNG');
        const sha256 = sha256Of(bytes);

        const res = await postAvatar(booted.app, user.cookie, bytes, 'image/png');
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.image).toBe(`/api/avatars/${ sha256 }`);
        expect(await avatarRow(booted, user.id)).toEqual({ avatar_sha256: sha256, avatar_mime: 'image/png' });
        expect(await bytesExist(booted, sha256)).toBe(true);
    });

    it('rejects an image over the configured cap with 413 and stores nothing', async () =>
    {
        const booted = await boot(8);
        const user = await makeUser(booted, 'a@example.com');

        const res = await postAvatar(booted.app, user.cookie, Buffer.from('nine byte'), 'image/png');

        expect(res.status).toBe(413);
        expect(await avatarRow(booted, user.id)).toEqual({ avatar_sha256: null, avatar_mime: null });
    });

    it('rejects a non-whitelisted content type with 400 and stores nothing', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');

        const res = await postAvatar(booted.app, user.cookie, Buffer.from('<svg/>'), 'image/svg+xml');

        expect(res.status).toBe(400);
        expect(await avatarRow(booted, user.id)).toEqual({ avatar_sha256: null, avatar_mime: null });
    });

    it('graveyards the previous avatar blob when a replacement leaves it unreferenced', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const first = Buffer.from('first avatar');
        const second = Buffer.from('second avatar');
        const firstSha = sha256Of(first);
        const secondSha = sha256Of(second);

        await postAvatar(booted.app, user.cookie, first, 'image/png');
        await postAvatar(booted.app, user.cookie, second, 'image/jpeg');

        expect((await avatarRow(booted, user.id)).avatar_sha256).toBe(secondSha);
        expect(await blobDeletedAt(booted, firstSha)).not.toBeNull();
        expect(await blobDeletedAt(booted, secondSha)).toBeNull();
    });

    it('does not graveyard a replaced blob still held as another user\'s avatar', async () =>
    {
        const booted = await boot();
        const one = await makeUser(booted, 'one@example.com');
        const two = await makeUser(booted, 'two@example.com');
        const shared = Buffer.from('the same avatar image');
        const sharedSha = sha256Of(shared);

        // Both users adopt the identical image (one blob, deduped), then user one moves on.
        await postAvatar(booted.app, one.cookie, shared, 'image/png');
        await postAvatar(booted.app, two.cookie, shared, 'image/png');
        await postAvatar(booted.app, one.cookie, Buffer.from('a different image'), 'image/png');

        expect(await blobDeletedAt(booted, sharedSha)).toBeNull();
        expect(await bytesExist(booted, sharedSha)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('DELETE /api/me/avatar', () =>
{
    it('clears the reference and graveyards the orphaned blob', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('an avatar to remove');
        const sha256 = sha256Of(bytes);
        await postAvatar(booted.app, user.cookie, bytes, 'image/png');

        const res = await deleteAvatar(booted.app, user.cookie);

        expect(res.status).toBe(204);
        expect(await avatarRow(booted, user.id)).toEqual({ avatar_sha256: null, avatar_mime: null });
        expect(await blobDeletedAt(booted, sha256)).not.toBeNull();
    });

    it('clears the derived image on the me profile', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        await postAvatar(booted.app, user.cookie, Buffer.from('an avatar'), 'image/png');

        await deleteAvatar(booted.app, user.cookie);
        const me = await (await getMe(booted.app, user.cookie)).json();

        expect(me.image).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/avatars/:sha256', () =>
{
    it('serves the bytes with the stored mime and an immutable private cache', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('the avatar bytes to serve back');
        const sha256 = sha256Of(bytes);
        await postAvatar(booted.app, user.cookie, bytes, 'image/webp');

        const res = await getAvatar(booted.app, user.cookie, sha256);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/webp');
        expect(res.headers.get('cache-control')).toBe('private, immutable, max-age=31536000');
        expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    });

    it('404s a hash that exists in the blob store but is no user\'s avatar', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('private file content living in the dedup store');
        const sha256 = await seedUnreferencedBlob(booted, bytes);

        const res = await getAvatar(booted.app, user.cookie, sha256);

        // The bytes genuinely exist -- the 404 is the reference gate refusing to serve non-avatar content by hash.
        expect(await bytesExist(booted, sha256)).toBe(true);
        expect(res.status).toBe(404);
    });

    it('rejects an unauthenticated request with 401', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('an avatar');
        const sha256 = sha256Of(bytes);
        await postAvatar(booted.app, user.cookie, bytes, 'image/png');

        const res = await booted.app.request(`http://localhost:3000/api/avatars/${ sha256 }`);

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('avatar GC interaction', () =>
{
    it('does not reap a blob an avatar still references', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('an avatar GC must not touch');
        const sha256 = sha256Of(bytes);
        await postAvatar(booted.app, user.cookie, bytes, 'image/png');

        const summary = await runGcOnce({ handle: booted.handle, blob: booted.blob, graceMs: async () => 0 });

        expect(summary.deleted).toBe(0);
        expect(await blobRowExists(booted, sha256)).toBe(true);
        expect(await bytesExist(booted, sha256)).toBe(true);
    });

    it('reaps the blob once the avatar referencing it is removed', async () =>
    {
        const booted = await boot();
        const user = await makeUser(booted, 'a@example.com');
        const bytes = Buffer.from('an avatar to reap after removal');
        const sha256 = sha256Of(bytes);
        await postAvatar(booted.app, user.cookie, bytes, 'image/png');
        await deleteAvatar(booted.app, user.cookie);

        // A cutoff 1s in the future puts the just-graveyarded blob unambiguously past the grace window (a 0 grace can
        // tie the same millisecond the delete stamped deleted_at). The point is that the removed avatar no longer
        // protects the blob, so the sweep is now free to reap it.
        await runGcOnce({ handle: booted.handle, blob: booted.blob, graceMs: async () => -1000 });

        expect(await blobRowExists(booted, sha256)).toBe(false);
        expect(await bytesExist(booted, sha256)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
