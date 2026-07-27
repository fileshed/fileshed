//----------------------------------------------------------------------------------------------------------------------
// Playlist File Engine — the FileShed .m3u8 dialect
//
// The contract: a saved playlist is a valid Extended M3U -- #EXTM3U header, #EXTINF per entry, one location line
// per entry (relative drive path or absolute URL) -- with a #FILESHED:node= comment carrying each drive entry's
// node id. Parsing reads that dialect back, tolerates plain unextended M3U (bare location lines are entries),
// classifies http(s) lines as remote URLs, and ignores comments it doesn't know.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { parsePlaylist, serializePlaylist } from '@client/engines/media/playlistFile.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('parsePlaylist', () =>
{
    it('reads the FileShed dialect: playlist title, node ids, entry titles, paths, and remote URLs', () =>
    {
        const text = [
            '#EXTM3U',
            '#PLAYLIST:Road Trip 2026',
            '#FILESHED:node=abc123',
            '#EXTINF:-1,The Sample Band - Neon Skyline',
            'Music/Neon Skyline.mp3',
            '#EXTINF:243,Stream',
            'https://radio.example/stream.mp3',
            '',
        ].join('\n');

        expect(parsePlaylist(text)).toEqual({
            title: 'Road Trip 2026',
            entries: [
                {
                    nodeID: 'abc123',
                    url: null,
                    path: 'Music/Neon Skyline.mp3',
                    title: 'The Sample Band - Neon Skyline',
                },
                { nodeID: null, url: 'https://radio.example/stream.mp3', path: null, title: 'Stream' },
            ],
        });
    });

    it('reads a plain unextended M3U: bare location lines are entries, and there is no title', () =>
    {
        expect(parsePlaylist('one.mp3\r\ntwo.mp3\r\n')).toEqual({
            title: null,
            entries: [
                { nodeID: null, url: null, path: 'one.mp3', title: null },
                { nodeID: null, url: null, path: 'two.mp3', title: null },
            ],
        });
    });

    it('attaches metadata comments only to the entry directly after them', () =>
    {
        const text = [
            '#FILESHED:node=abc123',
            'one.mp3',
            'two.mp3',
        ].join('\n');

        const { entries } = parsePlaylist(text);

        expect(entries[0]?.nodeID).toBe('abc123');
        expect(entries[1]?.nodeID).toBeNull();
    });
});

describe('serializePlaylist', () =>
{
    it('writes a valid Extended M3U with the node comment before each drive entry', () =>
    {
        const text = serializePlaylist([
            { nodeID: 'abc123', url: null, relativePath: 'Music/Neon Skyline.mp3', title: 'Neon Skyline' },
            { nodeID: null, url: 'https://radio.example/stream.mp3', relativePath: null, title: 'Stream' },
        ]);

        expect(text).toBe([
            '#EXTM3U',
            '#FILESHED:node=abc123',
            '#EXTINF:-1,Neon Skyline',
            'Music/Neon Skyline.mp3',
            '#EXTINF:-1,Stream',
            'https://radio.example/stream.mp3',
            '',
        ].join('\n'));
    });

    it('writes the display title as the standard #PLAYLIST directive, omitted when blank', () =>
    {
        const rows = [ { nodeID: 'n1', url: null, relativePath: 'a.mp3', title: 'A' } ];

        expect(serializePlaylist(rows, 'Road Trip 2026')).toContain('#PLAYLIST:Road Trip 2026');
        expect(serializePlaylist(rows, '   ')).not.toContain('#PLAYLIST');
        expect(serializePlaylist(rows)).not.toContain('#PLAYLIST');
    });

    it('round-trips through its own parser, title included', () =>
    {
        const rows = [
            { nodeID: 'n1', url: null, relativePath: 'a.mp3', title: 'A' },
            { nodeID: null, url: 'https://x.example/b.mp3', relativePath: null, title: 'B' },
        ];

        expect(parsePlaylist(serializePlaylist(rows, 'Mix'))).toEqual({
            title: 'Mix',
            entries: [
                { nodeID: 'n1', url: null, path: 'a.mp3', title: 'A' },
                { nodeID: null, url: 'https://x.example/b.mp3', path: null, title: 'B' },
            ],
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
