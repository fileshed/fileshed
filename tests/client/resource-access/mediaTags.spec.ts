//----------------------------------------------------------------------------------------------------------------------
// Media Tags Resource Access — embedded tag reads over the inline download endpoint
//
// The contract: a tagged file maps to the domain shape (title, artist, album, an object URL for the cover); the
// artist falls back to the first of the artists list; a file carrying nothing useful resolves to null, as do
// unreadable files and parser failures — tags never throw. releaseMediaTags revokes the artwork URL and tolerates
// tag sets that have none. The parser and fetch are mocked; this guards the mapping and the failure posture.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Under test
import { readMediaTags, releaseMediaTags } from '@client/resource-access/mediaTags.ts';

//----------------------------------------------------------------------------------------------------------------------

const { parseWebStreamMock, selectCoverMock } = vi.hoisted(() => ({
    parseWebStreamMock: vi.fn(),
    selectCoverMock: vi.fn(),
}));

vi.mock('music-metadata', () => ({
    parseWebStream: parseWebStreamMock,
    selectCover: selectCoverMock,
}));

const fetchMock = vi.fn();
const createObjectURLMock = vi.fn(() => 'blob:fake-cover');
const revokeObjectURLMock = vi.fn();

function okResponse() : unknown
{
    return {
        ok: true,
        body: {},
        headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '65244' }),
    };
}

function metadataWith(common : Record<string, unknown>) : unknown
{
    return { common };
}

beforeEach(() =>
{
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
    }));

    fetchMock.mockResolvedValue(okResponse());
    selectCoverMock.mockReturnValue(null);
});

afterEach(() => { vi.unstubAllGlobals(); });

//----------------------------------------------------------------------------------------------------------------------

describe('readMediaTags', () =>
{
    it('maps a tagged file to the domain shape, with the cover as an object URL', async () =>
    {
        parseWebStreamMock.mockResolvedValue(metadataWith({
            title: '  Neon Skyline ',
            artist: 'The Sample Band',
            album: 'Fixtures',
            picture: [ {} ],
        }));
        selectCoverMock.mockReturnValue({ format: 'image/png', data: new Uint8Array([ 1, 2 ]) });

        const tags = await readMediaTags('n1');

        expect(tags).toEqual({
            title: 'Neon Skyline',
            artist: 'The Sample Band',
            album: 'Fixtures',
            artworkUrl: 'blob:fake-cover',
        });
    });

    it('falls back to the first of the artists list when no single artist is tagged', async () =>
    {
        parseWebStreamMock.mockResolvedValue(metadataWith({
            title: 'Neon Skyline',
            artists: [ 'The Sample Band', 'Guest Act' ],
        }));

        const tags = await readMediaTags('n1');

        expect(tags?.artist).toBe('The Sample Band');
    });

    it('resolves null for a file carrying nothing useful', async () =>
    {
        parseWebStreamMock.mockResolvedValue(metadataWith({}));

        expect(await readMediaTags('n1')).toBeNull();
    });

    it('resolves null instead of throwing when the read or the parse fails', async () =>
    {
        fetchMock.mockResolvedValue({ ok: false, body: null, headers: new Headers() });
        expect(await readMediaTags('n1')).toBeNull();

        fetchMock.mockRejectedValue(new Error('offline'));
        expect(await readMediaTags('n1')).toBeNull();

        fetchMock.mockResolvedValue(okResponse());
        parseWebStreamMock.mockRejectedValue(new Error('not media'));
        expect(await readMediaTags('n1')).toBeNull();
    });
});

describe('releaseMediaTags', () =>
{
    it('revokes the artwork URL, and tolerates tags without one', () =>
    {
        releaseMediaTags({ title: 't', artist: null, album: null, artworkUrl: 'blob:fake-cover' });
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:fake-cover');

        releaseMediaTags({ title: 't', artist: null, album: null, artworkUrl: null });
        expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
