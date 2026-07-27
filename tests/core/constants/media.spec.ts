//----------------------------------------------------------------------------------------------------------------------
// Media Constants — playlist classification
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { isPlaylistFile } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('isPlaylistFile', () =>
{
    it('recognizes a playlist by mime or by extension, whichever the upload preserved', () =>
    {
        expect(isPlaylistFile('audio/x-mpegurl', 'mix.weird')).toBe(true);
        expect(isPlaylistFile('application/vnd.apple.mpegurl', 'mix.weird')).toBe(true);
        expect(isPlaylistFile('application/octet-stream', 'mix.M3U8')).toBe(true);
        expect(isPlaylistFile('text/plain', 'mix.m3u')).toBe(true);
        expect(isPlaylistFile('audio/mpeg', 'song.mp3')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
