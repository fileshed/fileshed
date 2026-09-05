//----------------------------------------------------------------------------------------------------------------------
// Media Player Store — the playlist session
//
// The contract: opening the page seats the routed file as the sole track with autoplay off (the user presses play);
// adds append without disturbing what's current; any queue-driven track change — row click, previous/next, the
// ended-track advance — arms autoplay for the incoming track; removing the current track promotes a neighbour but
// does NOT arm autoplay (editing the list is not a request to start sound); reset empties the session. A folder
// add queues the folder's media files first and then each subfolder's, depth-capped, counting what it seated.
// Embedded tags are read once per node as tracks join the queue, missing tags leave rows on their filenames, and
// reset releases any artwork object URLs. Only the RA boundary (tags reads, folder listings) is mocked.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import { MEDIA_FOLDER_ADD_MAX_DEPTH, type NodeListResponse, type NodeResponse } from '@fileshed/core';

// Resource Access
import type { MediaTags } from '@client/resource-access/mediaTags.ts';

// Stores
import { useMediaPlayerStore } from '@client/stores/mediaPlayer.ts';

//----------------------------------------------------------------------------------------------------------------------

const {
    readMediaTagsMock,
    releaseMediaTagsMock,
    getChildrenMock,
    getNodeMock,
    fetchNodeBlobMock,
    claimBlobMock,
    uploadTicketMock,
    hashFileMock,
    mintPlaybackTokenMock,
} = vi.hoisted(() => ({
    readMediaTagsMock: vi.fn(),
    releaseMediaTagsMock: vi.fn(),
    getChildrenMock: vi.fn(),
    getNodeMock: vi.fn(),
    fetchNodeBlobMock: vi.fn(),
    claimBlobMock: vi.fn(),
    uploadTicketMock: vi.fn(),
    hashFileMock: vi.fn(),
    mintPlaybackTokenMock: vi.fn(),
}));

vi.mock('@client/resource-access/mediaTags.ts', () => ({
    readMediaTags: readMediaTagsMock,
    releaseMediaTags: releaseMediaTagsMock,
}));

vi.mock('@client/resource-access/nodes.ts', () => ({ getChildren: getChildrenMock, getNode: getNodeMock }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: fetchNodeBlobMock }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: claimBlobMock,
    uploadTicket: uploadTicketMock,
    answerChallenge: vi.fn(),
}));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: hashFileMock, readSampleWindows: vi.fn() }));
vi.mock('@client/resource-access/accessTokens.ts', () => ({ mintPlaybackToken: mintPlaybackTokenMock }));

function someTags(overrides : Partial<MediaTags> = {}) : MediaTags
{
    return {
        title: 'Neon Skyline',
        artist: 'The Sample Band',
        album: 'Fixtures',
        artworkUrl: 'blob:fake-cover',
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode(
    overrides : Partial<{ id : string; name : string; mimeType : string; parentID : string | null }> = {}
) : NodeResponse
{
    return {
        id: overrides.id ?? 'f1',
        name: overrides.name ?? 'song.mp3',
        ownerID: 'u1',
        parentID: overrides.parentID ?? null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: overrides.mimeType ?? 'audio/mpeg',
        trashedAt: null,
    };
}

function folderNode(overrides : Partial<{ id : string; name : string; parentID : string | null }> = {}) : NodeResponse
{
    return {
        id: overrides.id ?? 'd1',
        name: overrides.name ?? 'Music',
        ownerID: 'u1',
        parentID: overrides.parentID ?? null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

function listing(nodes : NodeResponse[]) : NodeListResponse
{
    return { nodes, total: nodes.length, limit: 200, offset: 0, owners: [] };
}

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    readMediaTagsMock.mockResolvedValue(null);

    // A failed mint is the store's quiet default -- in-page playback rides the cookie -- so specs not about the
    // token see exactly the pre-token behavior. Token specs override this per case.
    mintPlaybackTokenMock.mockRejectedValue(new Error('no token in this spec'));
});

//----------------------------------------------------------------------------------------------------------------------

describe('MediaPlayerStore.open', () =>
{
    it('seats the routed file as the sole current track with autoplay off', () =>
    {
        const store = useMediaPlayerStore();

        store.open(fileNode({ id: 'a1', name: 'one.mp3' }), 'audio');

        expect(store.track?.nodeID).toBe('a1');
        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1' ]);
        expect(store.currentIndex).toBe(0);
        expect(store.autoplay).toBe(false);
        expect(store.hasPrevious).toBe(false);
        expect(store.hasNext).toBe(false);
    });

    it('replaces the whole session when called again for a different file', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));

        store.open(fileNode({ id: 'v1', mimeType: 'video/mp4' }), 'video');

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'v1' ]);
        expect(store.track?.kind).toBe('video');
    });
});

describe('MediaPlayerStore.add', () =>
{
    it('appends to the end without moving the current track or arming autoplay', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        store.add(fileNode({ id: 'a2', name: 'two.mp3' }));

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1', 'a2' ]);
        expect(store.track?.nodeID).toBe('a1');
        expect(store.hasNext).toBe(true);
        expect(store.autoplay).toBe(false);
    });

    it('drops a non-media node instead of seating it', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        store.add(folderNode());
        store.add(fileNode({ id: 't1', mimeType: 'text/plain' }));

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1' ]);
    });

    it('seats the added track as current — without autoplay — when the playlist was emptied', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.removeTrack(0);

        store.add(fileNode({ id: 'a2' }));

        expect(store.track?.nodeID).toBe('a2');
        expect(store.autoplay).toBe(false);
    });
});

describe('MediaPlayerStore.select', () =>
{
    it('jumps to the clicked row and arms autoplay', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.add(fileNode({ id: 'a3' }));

        store.select(2);

        expect(store.track?.nodeID).toBe('a3');
        expect(store.currentIndex).toBe(2);
        expect(store.autoplay).toBe(true);
    });

    it('leaves autoplay unarmed when the clicked row is already current — no restart', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        store.select(0);

        expect(store.autoplay).toBe(false);
    });
});

describe('MediaPlayerStore.next / previous', () =>
{
    it('moves through the queue arming autoplay each step', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));

        store.next();
        expect(store.track?.nodeID).toBe('a2');
        expect(store.autoplay).toBe(true);

        store.previous();
        expect(store.track?.nodeID).toBe('a1');
    });

    it('does nothing at the queue boundaries', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        store.next();
        store.previous();

        expect(store.track?.nodeID).toBe('a1');
        expect(store.autoplay).toBe(false);
    });
});

describe('MediaPlayerStore.removeTrack', () =>
{
    it('promotes the successor when the current track is removed, without arming autoplay', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));

        store.removeTrack(0);

        expect(store.track?.nodeID).toBe('a2');
        expect(store.autoplay).toBe(false);
    });

    it('removes a non-current row without disturbing playback state', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.add(fileNode({ id: 'a3' }));
        store.select(1);

        store.removeTrack(2);

        expect(store.track?.nodeID).toBe('a2');
        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a1', 'a2' ]);
    });

    it('empties the playlist when the only track is removed', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');

        store.removeTrack(0);

        expect(store.track).toBeNull();
        expect(store.tracks).toEqual([]);
        expect(store.currentIndex).toBe(-1);
    });
});

describe('MediaPlayerStore repeat', () =>
{
    it('cycles the repeat mode off → all → one → off', () =>
    {
        const store = useMediaPlayerStore();

        expect(store.repeat).toBe('off');
        store.cycleRepeat();
        expect(store.repeat).toBe('all');
        store.cycleRepeat();
        expect(store.repeat).toBe('one');
        store.cycleRepeat();
        expect(store.repeat).toBe('off');
    });

    it('replays the ended track under repeat-one, remounting it playing', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.cycleRepeat();
        store.cycleRepeat();

        const playing = store.playToken;
        store.advance();

        expect(store.track?.nodeID).toBe('a1');
        expect(store.playToken).toBe(playing + 1);
        expect(store.autoplay).toBe(true);
    });

    it('wraps from the tail back to the first track under repeat-all', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.cycleRepeat();
        store.next();

        store.advance();

        expect(store.track?.nodeID).toBe('a1');
        expect(store.autoplay).toBe(true);
    });

    it('stops at the tail under repeat-off — an ended last track changes nothing', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.next();

        const playing = store.playToken;
        store.advance();

        expect(store.track?.nodeID).toBe('a2');
        expect(store.playToken).toBe(playing);
    });

    it('keeps Next alive at the tail once repeat-all can wrap around', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.next();

        expect(store.hasNext).toBe(false);
        store.cycleRepeat();
        expect(store.hasNext).toBe(true);
    });
});

describe('MediaPlayerStore shuffle', () =>
{
    it('advances to a not-yet-played track, exhausts the cycle, then stops under repeat-off', () =>
    {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.add(fileNode({ id: 'a3' }));
        store.toggleShuffle();

        store.advance();
        expect(store.track?.nodeID).toBe('a2');
        expect(store.autoplay).toBe(true);

        store.advance();
        expect(store.track?.nodeID).toBe('a3');

        const playing = store.playToken;
        store.advance();
        expect(store.track?.nodeID).toBe('a3');
        expect(store.playToken).toBe(playing);

        random.mockRestore();
    });

    it('starts a fresh cycle at exhaustion under repeat-all instead of stopping', () =>
    {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.toggleShuffle();
        store.cycleRepeat();

        store.advance();
        expect(store.track?.nodeID).toBe('a2');

        store.advance();
        expect(store.track?.nodeID).toBe('a1');
        expect(store.autoplay).toBe(true);

        random.mockRestore();
    });

    it('a pressed Next never dead-ends: an exhausted cycle starts over', () =>
    {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.toggleShuffle();

        store.next();
        store.next();
        store.next();

        expect(store.autoplay).toBe(true);
        expect(store.track?.nodeID).toBe('a2');

        random.mockRestore();
    });

    it('keeps Next alive at the tail while shuffle can jump elsewhere', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.next();

        expect(store.hasNext).toBe(false);
        store.toggleShuffle();
        expect(store.hasNext).toBe(true);
    });
});

describe('MediaPlayerStore.playToken', () =>
{
    it('moves only when playback intent changes -- editing the rest of the list never remounts the player', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.add(fileNode({ id: 'a3' }));
        store.select(2);

        const playing = store.playToken;
        store.add(fileNode({ id: 'a4' }));
        store.removeTrack(0);

        expect(store.track?.nodeID).toBe('a3');
        expect(store.playToken).toBe(playing);
    });

    it('moves for open, a row click, previous/next, and the current track being removed', () =>
    {
        const store = useMediaPlayerStore();

        store.open(fileNode({ id: 'a1' }), 'audio');
        const opened = store.playToken;

        store.add(fileNode({ id: 'a2' }));
        store.next();
        expect(store.playToken).toBe(opened + 1);

        store.previous();
        expect(store.playToken).toBe(opened + 2);

        store.select(1);
        expect(store.playToken).toBe(opened + 3);

        store.removeTrack(1);
        expect(store.playToken).toBe(opened + 4);
    });
});

describe('MediaPlayerStore playlist files', () =>
{
    const DIALECT = [
        '#EXTM3U',
        '#PLAYLIST:Road Mix',
        '#FILESHED:node=a1',
        '#EXTINF:-1,One',
        'one.mp3',
        '#FILESHED:node=gone',
        '#EXTINF:-1,Two',
        'Music/two.mp3',
        '#EXTINF:-1,Radio',
        'https://radio.example/live.mp3',
        '#EXTINF:-1,Ghost',
        'missing.mp3',
        '',
    ].join('\n');

    function mockPlaylistWorld() : void
    {
        fetchNodeBlobMock.mockResolvedValue(new Blob([ DIALECT ]));

        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'a1') { return Promise.resolve(fileNode({ id: 'a1', name: 'one.mp3', parentID: 'dir' })); }

            return Promise.reject(new Error('gone'));
        });

        getChildrenMock.mockImplementation((parentID : string | null, query : { name ?: string } = {}) =>
        {
            if(parentID === 'dir' && query.name === 'Music')
            {
                return Promise.resolve(listing([ folderNode({ id: 'dir-music', name: 'Music', parentID: 'dir' }) ]));
            }

            if(parentID === 'dir-music' && query.name === 'two.mp3')
            {
                return Promise.resolve(listing([ fileNode({ id: 'a2', name: 'two.mp3', parentID: 'dir-music' }) ]));
            }

            return Promise.resolve(listing([]));
        });
    }

    it('resolves entries node-id first, then by relative path, streams URLs, and keeps broken rows', async () =>
    {
        mockPlaylistWorld();
        const store = useMediaPlayerStore();

        const outcome = await store.openPlaylistNode(
            fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }),
            'replace'
        );

        expect(outcome).toEqual({ resolved: 3, broken: 1 });
        expect(store.tracks.map((entry) => entry.nodeID))
            .toEqual([ 'a1', 'a2', 'https://radio.example/live.mp3', 'broken:3' ]);
        expect(store.tracks[2]?.remoteUrl).toBe('https://radio.example/live.mp3');
        expect(store.tracks[2]?.name).toBe('Radio');
        expect(store.tracks[3]?.broken).toBe(true);
        expect(store.tracks[3]?.name).toBe('Ghost');
        expect(store.playlistNode?.id).toBe('pl');
        expect(store.playlistTitle).toBe('Road Mix');
        expect(store.autoplay).toBe(false);
    });

    it('appends into the current session without adopting the appended file', async () =>
    {
        mockPlaylistWorld();
        fetchNodeBlobMock.mockResolvedValue(new Blob([ '#EXTM3U\n#FILESHED:node=a1\none.mp3\n' ]));

        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a0', name: 'zero.mp3' }), 'audio');

        await store.openPlaylistNode(fileNode({ id: 'pl', name: 'mix.m3u8' }), 'append');

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a0', 'a1' ]);
        expect(store.playlistNode).toBeNull();
    });

    it('Save As writes the dialect with paths relative to the browsed folder and adopts the new file', async () =>
    {
        hashFileMock.mockResolvedValue('sha-pl');
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadTicketMock.mockResolvedValue(fileNode({ id: 'pl-new', name: 'mix.m3u8', parentID: 'dir' }));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'a1') { return Promise.resolve(fileNode({ id: 'a1', name: 'one.mp3', parentID: 'dir' })); }
            if(id === 'a2') { return Promise.resolve(fileNode({ id: 'a2', name: 'two.mp3', parentID: 'dir-music' })); }
            if(id === 'dir') { return Promise.resolve(folderNode({ id: 'dir', name: 'Stuff', parentID: null })); }

            return Promise.resolve(folderNode({ id: 'dir-music', name: 'Music', parentID: 'dir' }));
        });

        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1', name: 'one.mp3', parentID: 'dir' }), 'audio');
        store.add(fileNode({ id: 'a2', name: 'two.mp3', parentID: 'dir-music' }));

        await store.savePlaylistAs('mix', 'Fresh Mix');

        const [ ticket, body, commit ] = uploadTicketMock.mock.calls[0] ?? [];
        expect(ticket).toBe('TKT');
        expect(commit).toEqual({ name: 'mix.m3u8', parentID: 'dir', mimeType: 'audio/x-mpegurl' });

        const text = await (body as File).text();
        expect(text).toContain('#EXTM3U');
        expect(text).toContain('#PLAYLIST:Fresh Mix');
        expect(text).toContain('#FILESHED:node=a1');
        expect(text).toContain('\none.mp3');
        expect(text).toContain('Music/two.mp3');

        expect(store.playlistNode?.id).toBe('pl-new');
        expect(store.playlistTitle).toBe('Fresh Mix');
    });

    it('Save As onto the adopted file\'s own name overwrites it instead of forking a duplicate', async () =>
    {
        mockPlaylistWorld();
        fetchNodeBlobMock.mockResolvedValue(new Blob([ '#EXTM3U\n#FILESHED:node=a1\none.mp3\n' ]));
        hashFileMock.mockResolvedValue('sha-pl');
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadTicketMock.mockResolvedValue(fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }));

        const store = useMediaPlayerStore();
        await store.openPlaylistNode(fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }), 'replace');

        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'a1') { return Promise.resolve(fileNode({ id: 'a1', name: 'one.mp3', parentID: 'dir' })); }

            return Promise.resolve(folderNode({ id: 'dir', name: 'Stuff', parentID: null }));
        });

        await store.savePlaylistAs('mix.m3u8');

        const [ , , commit ] = uploadTicketMock.mock.calls[0] ?? [];
        expect(commit).toEqual({ replaceNodeID: 'pl', mimeType: 'audio/x-mpegurl' });
    });

    it('retitles by writing the new title through to the adopted file, reverting if the write fails', async () =>
    {
        mockPlaylistWorld();
        fetchNodeBlobMock.mockResolvedValue(new Blob([ '#EXTM3U\n#PLAYLIST:Old Title\n#FILESHED:node=a1\none.mp3\n' ]));
        hashFileMock.mockResolvedValue('sha-pl');
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadTicketMock.mockResolvedValue(fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }));

        const store = useMediaPlayerStore();
        await store.openPlaylistNode(fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }), 'replace');

        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'a1') { return Promise.resolve(fileNode({ id: 'a1', name: 'one.mp3', parentID: 'dir' })); }

            return Promise.resolve(folderNode({ id: 'dir', name: 'Stuff', parentID: null }));
        });

        await store.retitlePlaylist('New Title');

        expect(store.playlistTitle).toBe('New Title');
        const [ , body ] = uploadTicketMock.mock.calls[0] ?? [];
        expect(await (body as File).text()).toContain('#PLAYLIST:New Title');

        uploadTicketMock.mockRejectedValue(new Error('offline'));
        await expect(store.retitlePlaylist('Doomed Title')).rejects.toThrow('offline');
        expect(store.playlistTitle).toBe('New Title');
    });

    it('Save overwrites the adopted file, guarded by the blob it last read, keeping the title', async () =>
    {
        mockPlaylistWorld();
        fetchNodeBlobMock.mockResolvedValue(
            new Blob([ '#EXTM3U\n#PLAYLIST:Keeper\n#FILESHED:node=a1\none.mp3\n' ])
        );
        hashFileMock.mockResolvedValue('sha-pl');
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadTicketMock.mockResolvedValue(fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }));

        const store = useMediaPlayerStore();
        await store.openPlaylistNode(fileNode({ id: 'pl', name: 'mix.m3u8', parentID: 'dir' }), 'replace');

        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'a1') { return Promise.resolve(fileNode({ id: 'a1', name: 'one.mp3', parentID: 'dir' })); }

            return Promise.resolve(folderNode({ id: 'dir', name: 'Stuff', parentID: null }));
        });

        await store.savePlaylist();

        const [ , body, commit ] = uploadTicketMock.mock.calls[0] ?? [];
        expect(commit).toEqual({ replaceNodeID: 'pl', ifBlobID: 'b1', mimeType: 'audio/x-mpegurl' });
        expect(await (body as File).text()).toContain('#PLAYLIST:Keeper');
    });
});

describe('MediaPlayerStore.reset', () =>
{
    it('clears the session back to empty', () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a2' }));
        store.select(1);

        store.reset();

        expect(store.track).toBeNull();
        expect(store.tracks).toEqual([]);
        expect(store.autoplay).toBe(false);
    });
});

describe('MediaPlayerStore.addFolder', () =>
{
    it('queues a folder\'s media in listing order, then each subfolder\'s, skipping non-media', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string) =>
        {
            if(parentID === 'dir')
            {
                return Promise.resolve(listing([
                    folderNode({ id: 'sub', name: 'Albums' }),
                    fileNode({ id: 'a1', name: 'one.mp3' }),
                    fileNode({ id: 't1', name: 'notes.txt', mimeType: 'text/plain' }),
                ]));
            }

            return Promise.resolve(listing([ fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' }) ]));
        });

        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a0' }), 'audio');

        const seated = await store.addFolder('dir');

        expect(seated).toBe(2);
        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a0', 'a1', 'v1' ]);
    });

    it('stops descending at the depth cap instead of walking a pathological tree', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string) =>
        {
            const level = Number(parentID.slice(1));

            return Promise.resolve(listing([
                fileNode({ id: `a${ level }`, name: `track-${ level }.mp3` }),
                folderNode({ id: `d${ level + 1 }` }),
            ]));
        });

        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'root' }), 'audio');

        const seated = await store.addFolder('d0');

        expect(seated).toBe(MEDIA_FOLDER_ADD_MAX_DEPTH + 1);
    });

    it('propagates a listing failure so the caller can surface it', async () =>
    {
        getChildrenMock.mockRejectedValue(new Error('boom'));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a0' }), 'audio');

        await expect(store.addFolder('dir')).rejects.toThrow('boom');
        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'a0' ]);
    });
});

describe('MediaPlayerStore tags', () =>
{
    it('reads a track\'s embedded tags when it joins the queue and serves them from the cache', async () =>
    {
        readMediaTagsMock.mockResolvedValue(someTags());
        const store = useMediaPlayerStore();

        store.open(fileNode({ id: 'a1' }), 'audio');
        await flushPromises();

        expect(store.tagsFor('a1')?.title).toBe('Neon Skyline');
        expect(store.tagsFor('a1')?.artist).toBe('The Sample Band');
    });

    it('reads each node once, even when it is queued twice', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        store.add(fileNode({ id: 'a1' }));
        await flushPromises();
        store.add(fileNode({ id: 'a1' }));
        await flushPromises();

        expect(readMediaTagsMock).toHaveBeenCalledTimes(1);
    });

    it('leaves an untagged file on its filename — tagsFor answers null', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        await flushPromises();

        expect(store.tagsFor('a1')).toBeNull();
    });

    it('releases artwork and forgets all tags on reset', async () =>
    {
        const withArt = someTags();
        readMediaTagsMock.mockResolvedValue(withArt);
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'a1' }), 'audio');
        await flushPromises();

        store.reset();

        expect(store.tagsFor('a1')).toBeNull();
        expect(releaseMediaTagsMock).toHaveBeenCalledWith(withArt);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The playback token: minted when a session opens so cast receivers can fetch tokened src URLs cookie-less,
// refreshed on a track change near expiry (retiring the predecessor), and treated as the suspect on a track error
// once it is dead -- a credential loss re-mints and remounts, it never skips the queue.
//----------------------------------------------------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

function tokenResponse(id : string, msUntilExpiry : number) : { id : string; token : string; expiresAt : string }
{
    return { id, token: `fsplay_${ id }`, expiresAt: new Date(Date.now() + msUntilExpiry).toISOString() };
}

describe('MediaPlayerStore playback token', () =>
{
    // In-page playback is a same-origin request and carries the session cookie, so a key here would only put a
    // credential in a URL that never needed one -- and a URL is the thing every proxy on the way writes down.
    it('mints nothing when a file opens', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();

        store.open(fileNode(), 'audio');
        await flushPromises();

        expect(mintPlaybackTokenMock).not.toHaveBeenCalled();
        expect(store.playbackToken).toBeNull();
    });

    it('does not mint as tracks change while nothing is casting', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));

        store.select(1);
        await flushPromises();

        expect(mintPlaybackTokenMock).not.toHaveBeenCalled();
    });

    // A receiver fetches the URL itself with no cookie jar of its own, which is the whole reason the key exists.
    it('mints when a cast session starts', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode(), 'audio');

        await store.beginCasting();

        expect(store.playbackToken?.token).toBe('fsplay_k1');
    });

    // A remote connection announces itself as `connecting` and again as `connect`, and a player mounted against an
    // already-connected session says so a third time.
    it('mints once for a cast session, however often the connection announces itself', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode(), 'audio');

        await store.beginCasting();
        await store.beginCasting();

        expect(mintPlaybackTokenMock).toHaveBeenCalledTimes(1);
    });

    it('carries on without a token when the mint fails, so playback is never blocked', async () =>
    {
        const store = useMediaPlayerStore();

        store.open(fileNode(), 'audio');
        await store.beginCasting();

        expect(store.playbackToken).toBeNull();
        expect(store.playToken).toBe(1);
    });

    it('refreshes on a track change inside the final window, retiring the predecessor', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 10 * 60 * 1000));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        await store.beginCasting();
        expect(store.playbackToken?.id).toBe('k1');

        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k2', 5 * HOUR_MS));
        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));
        store.select(1);
        await flushPromises();

        expect(mintPlaybackTokenMock).toHaveBeenLastCalledWith('k1');
        expect(store.playbackToken?.id).toBe('k2');
    });

    it('leaves a fresh token alone across track changes', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        await store.beginCasting();

        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));
        store.select(1);
        await flushPromises();

        expect(mintPlaybackTokenMock).toHaveBeenCalledTimes(1);
        expect(store.playbackToken?.id).toBe('k1');
    });

    it('treats a track error with a dead token as a credential loss: re-mints and remounts, never skips', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', -1000));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        await store.beginCasting();
        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));
        const mountsBefore = store.playToken;

        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k2', 5 * HOUR_MS));
        store.handleTrackError();
        await flushPromises();

        expect(store.currentIndex).toBe(0);
        expect(store.playbackToken?.id).toBe('k2');
        expect(store.autoplay).toBe(true);
        expect(store.playToken).toBe(mountsBefore + 1);
    });

    it('skips on a track error while the token is alive, marking the seat so playback never walks back in', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        await store.beginCasting();
        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));

        store.handleTrackError();

        expect(store.currentIndex).toBe(1);
        expect(store.tracks[0]?.failed).toBe(true);
    });

    it('clears the failed mark when the user deliberately selects the track again -- a click is a retry', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        await flushPromises();
        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));
        store.handleTrackError();
        expect(store.tracks[0]?.failed).toBe(true);

        store.select(0);

        expect(store.currentIndex).toBe(0);
        expect(store.tracks[0]?.failed).toBe(false);
        expect(store.autoplay).toBe(true);
    });

    it('reorders seats without remounting or arming playback', async () =>
    {
        const store = useMediaPlayerStore();
        store.open(fileNode({ id: 'f1' }), 'audio');
        store.add(fileNode({ id: 'f2', name: 'second.mp3' }));
        store.add(fileNode({ id: 'f3', name: 'third.mp3' }));
        const mountsBefore = store.playToken;

        store.move(2, 0);

        expect(store.tracks.map((entry) => entry.nodeID)).toEqual([ 'f3', 'f1', 'f2' ]);
        expect(store.track?.nodeID).toBe('f1');
        expect(store.currentIndex).toBe(1);
        expect(store.playToken).toBe(mountsBefore);
        expect(store.autoplay).toBe(false);
    });

    it('drops the token on reset', async () =>
    {
        mintPlaybackTokenMock.mockResolvedValue(tokenResponse('k1', 5 * HOUR_MS));
        const store = useMediaPlayerStore();
        store.open(fileNode(), 'audio');
        await flushPromises();

        store.reset();

        expect(store.playbackToken).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
