//----------------------------------------------------------------------------------------------------------------------
// Media Tags — extraction, the content-keyed rows, and the enrichment orchestration
//
// The contract: extraction pulls title/artist/album from real tag bytes and reads any failure as no-tags (a row of
// nulls, never an error); rows key by blob so extraction runs once per content; the manager only ever considers
// audio that is not a playlist, treats an existing row -- even all-null -- as final, and the backfill sweep walks
// exactly the audio blobs no row answers for yet.
//----------------------------------------------------------------------------------------------------------------------

import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MEDIA_TAG_MAX_LENGTH } from '@fileshed/core';

// Managers
import { MediaTagManager } from '@server/managers/mediaTags.ts';

// Resource Access
import { MediaTagsRA, extractTags } from '@server/resource-access/mediaTags/index.ts';

// Support
import { type BootedServeApp, type TestUser, bootServeApp, makeUser, uploadFile } from '../publicLinks/support.ts';
import { taggedMp3 } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('extractTags', () =>
{
    it('reads title, artist, and album out of real ID3 bytes', async () =>
    {
        const bytes = taggedMp3({ title: 'Neon Skyline', artist: 'The Sample Band', album: 'Fixtures' });

        const tags = await extractTags(Readable.from(bytes));

        expect(tags).toEqual({ title: 'Neon Skyline', artist: 'The Sample Band', album: 'Fixtures' });
    });

    it('reads garbage as no tags, never as an error', async () =>
    {
        const tags = await extractTags(Readable.from(Buffer.from('not audio at all')));

        expect(tags).toEqual({ title: null, artist: null, album: null });
    });

    // A tag frame carries whatever the tagger wrote, and what lands here is stored and returned in search responses.
    // Storing the front of a tag is enough to name a track; storing all of a megabyte-long one is the uploader
    // choosing how much of everyone's listing they occupy.
    it('stores the front of an outsized tag rather than all of it', async () =>
    {
        const bytes = taggedMp3({
            title: 'T'.repeat(MEDIA_TAG_MAX_LENGTH * 2),
            artist: 'A'.repeat(MEDIA_TAG_MAX_LENGTH + 1),
            album: 'Fixtures',
        });

        const tags = await extractTags(Readable.from(bytes));

        expect(tags.title).toBe('T'.repeat(MEDIA_TAG_MAX_LENGTH));
        expect(tags.artist).toBe('A'.repeat(MEDIA_TAG_MAX_LENGTH));
        expect(tags.album).toBe('Fixtures');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaTagsRA', () =>
{
    let booted : BootedServeApp;
    let owner : TestUser;

    beforeEach(async () =>
    {
        booted = await bootServeApp();
        owner = await makeUser(booted, 'owner@example.com');
    });

    afterEach(async () =>
    {
        await booted.cleanup();
    });

    it('round-trips tags keyed by blob, upserting in place', async () =>
    {
        const ra = new MediaTagsRA(booted.handle);
        const uploaded = await uploadFile(booted, owner, taggedMp3({ title: 'One' }), {
            name: 'one.mp3',
            mimeType: 'audio/mpeg',
        });

        await ra.upsert(uploaded.sha256, { title: 'One', artist: null, album: null });
        expect(await ra.get(uploaded.sha256)).toEqual({ title: 'One', artist: null, album: null });

        await ra.upsert(uploaded.sha256, { title: 'One', artist: 'Someone', album: null });
        expect((await ra.get(uploaded.sha256))?.artist).toBe('Someone');
    });

    it('lists only the audio blobs no extraction has answered for', async () =>
    {
        const ra = new MediaTagsRA(booted.handle);
        const audio = await uploadFile(booted, owner, taggedMp3({ title: 'A' }), {
            name: 'a.mp3',
            mimeType: 'audio/mpeg',
        });
        const text = await uploadFile(booted, owner, Buffer.from('hello'), {
            name: 'notes.txt',
            mimeType: 'text/plain',
        });

        // The upload route enriches in the background; drop any row it won the race to write, so this spec owns
        // the row state it asserts against.
        await booted.handle.db.deleteFrom('media_tags').execute();

        const before = await ra.untaggedAudioBlobs(10);
        expect(before.map((blob) => blob.blobID)).toEqual([ audio.sha256 ]);
        expect(before.map((blob) => blob.blobID)).not.toContain(text.sha256);

        await ra.upsert(audio.sha256, { title: null, artist: null, album: null });

        expect(await ra.untaggedAudioBlobs(10)).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaTagManager', () =>
{
    function fakeDeps(overrides : { existing ?: boolean; bytes ?: Buffer } = {}) : {
        upserts : { blobID : string; tags : unknown }[];
        manager : MediaTagManager;
        streams : number;
    }
    {
        const state = { upserts: [] as { blobID : string; tags : unknown }[], streams: 0 };

        const blob = {
            get: vi.fn((sha256 : string) => Promise.resolve({
                sha256,
                size: 100,
                backendID: 'b1',
                storageKey: sha256,
                deletedAt: null,
            })),
            getStream: vi.fn(() =>
            {
                state.streams += 1;
                return Promise.resolve(Readable.from(overrides.bytes ?? taggedMp3({ title: 'T' })));
            }),
        };

        const tags = {
            get: vi.fn(() => Promise.resolve(
                overrides.existing ? { title: null, artist: null, album: null } : undefined
            )),
            upsert: vi.fn((blobID : string, extracted : unknown) =>
            {
                state.upserts.push({ blobID, tags: extracted });
                return Promise.resolve();
            }),
            untaggedAudioBlobs: vi.fn(() => Promise.resolve([
                { blobID: 'sha-a', mimeType: 'audio/mpeg' },
                { blobID: 'sha-b', mimeType: 'audio/flac' },
            ])),
        };

        const manager = new MediaTagManager({
            blob: blob as never,
            tags: tags as never,
        });

        return { manager, upserts: state.upserts, get streams() { return state.streams; } };
    }

    it('extracts real tag bytes for audio content and persists what it found', async () =>
    {
        const deps = fakeDeps({ bytes: taggedMp3({ title: 'Neon', artist: 'Band', album: 'Fixtures' }) });

        await deps.manager.ensureFor('sha-1', 'audio/mpeg');

        expect(deps.upserts).toEqual([
            { blobID: 'sha-1', tags: { title: 'Neon', artist: 'Band', album: 'Fixtures' } },
        ]);
    });

    it('never touches non-audio content or playlists, and never re-extracts an answered blob', async () =>
    {
        const skipped = fakeDeps();
        await skipped.manager.ensureFor('sha-1', 'text/plain');
        await skipped.manager.ensureFor('sha-2', null);
        await skipped.manager.ensureFor('sha-3', 'audio/x-mpegurl');
        expect(skipped.streams).toBe(0);
        expect(skipped.upserts).toEqual([]);

        const answered = fakeDeps({ existing: true });
        await answered.manager.ensureFor('sha-4', 'audio/mpeg');
        expect(answered.streams).toBe(0);
        expect(answered.upserts).toEqual([]);
    });

    it('writes the no-tags row for an untagged file, so the sweep never retries it', async () =>
    {
        const deps = fakeDeps({ bytes: Buffer.from('not really audio') });

        await deps.manager.ensureFor('sha-1', 'audio/mpeg');

        expect(deps.upserts).toEqual([ { blobID: 'sha-1', tags: { title: null, artist: null, album: null } } ]);
    });

    it('sweeps one batch of unanswered blobs and reports how many it walked', async () =>
    {
        const deps = fakeDeps();

        const walked = await deps.manager.sweepOnce(10);

        expect(walked).toBe(2);
        expect(deps.upserts.map((entry) => entry.blobID)).toEqual([ 'sha-a', 'sha-b' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
