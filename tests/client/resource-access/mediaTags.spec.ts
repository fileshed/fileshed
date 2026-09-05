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

    // The cover's format comes off the tag frame verbatim and becomes the type of a blob: URL. That URL has no HTTP
    // response behind it, so no response header can ever say what the browser should treat it as -- the allowlist is
    // the only thing that can, and a type outside it means no artwork rather than an object URL of unknown kind.
    it('drops artwork whose declared format is outside the allowlist', async () =>
    {
        parseWebStreamMock.mockResolvedValue(metadataWith({ title: 'Neon Skyline', picture: [ {} ] }));
        selectCoverMock.mockReturnValue({ format: 'text/html', data: new Uint8Array([ 1, 2 ]) });

        const tags = await readMediaTags('n1');

        expect(tags?.artworkUrl).toBeNull();
        expect(createObjectURLMock).not.toHaveBeenCalled();
    });

    it('keeps artwork whose format carries a parameter, on the media type alone', async () =>
    {
        parseWebStreamMock.mockResolvedValue(metadataWith({ title: 'Neon Skyline', picture: [ {} ] }));
        selectCoverMock.mockReturnValue({ format: 'IMAGE/JPEG; charset=binary', data: new Uint8Array([ 1, 2 ]) });

        const tags = await readMediaTags('n1');

        expect(tags?.artworkUrl).toBe('blob:fake-cover');
        expect(createObjectURLMock.mock.calls[0]?.[0]).toMatchObject({ type: 'image/jpeg' });
    });

    // A file whose only tag was an artwork the allowlist refused carries nothing renderable, which is the same
    // answer as a file with no tags at all.
    it('resolves null when refused artwork was the only tag', async () =>
    {
        parseWebStreamMock.mockResolvedValue(metadataWith({ picture: [ {} ] }));
        selectCoverMock.mockReturnValue({ format: 'text/html', data: new Uint8Array([ 1, 2 ]) });

        expect(await readMediaTags('n1')).toBeNull();
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
