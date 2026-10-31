//----------------------------------------------------------------------------------------------------------------------
// MIME Types
//
// A stored mime type is emitted verbatim as a Content-Type header, so "valid" here means "a header can carry it" --
// the RFC 9110 media-type grammar, which is entirely printable ASCII. A type's family and a playlist's identity are
// what the drive's presentation and the client's open-intent registry key off.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    ARCHIVE_MIME_TYPES,
    MIME_TYPE_MAX_LENGTH,
    familyOfMimeType,
    isPlaylistFile,
    isValidMimeType,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('isValidMimeType', () =>
{
    it('accepts the types real uploads carry', () =>
    {
        const types = [
            'application/pdf',
            'image/png',
            'text/plain',
            'audio/x-mpegurl',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/octet-stream',
        ];

        expect(types.filter((type) => !isValidMimeType(type))).toEqual([]);
    });

    it('accepts a type carrying parameters, in token and quoted-string form', () =>
    {
        expect(isValidMimeType('text/plain; charset=utf-8')).toBe(true);
        expect(isValidMimeType('text/plain;charset="utf-8"')).toBe(true);
        expect(isValidMimeType('multipart/form-data; boundary=----x; charset=utf-8')).toBe(true);
    });

    // These are the values that make a response un-emittable: Node refuses them rather than writing them, so the
    // download of a node carrying one fails while the response is being built -- and keeps failing.
    it('rejects the characters a response header cannot carry', () =>
    {
        expect(isValidMimeType('text/plain\r\nX-Injected: 1')).toBe(false);
        expect(isValidMimeType('text/plain\n')).toBe(false);
        expect(isValidMimeType('text/plain\r')).toBe(false);
        expect(isValidMimeType('text/plain\x7f')).toBe(false);
        expect(isValidMimeType('text/plain\0')).toBe(false);
    });

    // A header value is Latin-1 on the wire, so any codepoint above U+00FF is unwritable -- and the shortest way to
    // reach one is an emoji.
    it('rejects a type carrying a codepoint outside Latin-1', () =>
    {
        expect(isValidMimeType('image/png💥')).toBe(false);
        expect(isValidMimeType('🎵/🎵')).toBe(false);
    });

    it('rejects a value that is not type/subtype at all', () =>
    {
        expect(isValidMimeType('')).toBe(false);
        expect(isValidMimeType('png')).toBe(false);
        expect(isValidMimeType('image/')).toBe(false);
        expect(isValidMimeType('/png')).toBe(false);
        expect(isValidMimeType('image/png/extra')).toBe(false);
        expect(isValidMimeType('image png')).toBe(false);
    });

    it('rejects a type past the length ceiling even when every character is legal', () =>
    {
        const subtype = 'a'.repeat(MIME_TYPE_MAX_LENGTH);

        expect(isValidMimeType(`image/${ subtype }`)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('familyOfMimeType', () =>
{
    it('classifies the prefix families by their leading mime segment', () =>
    {
        expect(familyOfMimeType('image/png')).toBe('images');
        expect(familyOfMimeType('image/svg+xml')).toBe('images');
        expect(familyOfMimeType('video/mp4')).toBe('video');
        expect(familyOfMimeType('audio/mpeg')).toBe('audio');
        expect(familyOfMimeType('text/plain')).toBe('documents');
        expect(familyOfMimeType('text/markdown')).toBe('documents');
    });

    // Word-processor formats are documents by exact mime, not by prefix -- their mimes don't start with text/.
    it('classifies the word-processor exacts as documents', () =>
    {
        expect(familyOfMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
            .toBe('documents');
        expect(familyOfMimeType('application/vnd.oasis.opendocument.text')).toBe('documents');
        expect(familyOfMimeType('application/msword')).toBe('documents');
    });

    // A pdf is its own family, not a document -- the client colours the two apart and the server filters them apart.
    it('classifies application/pdf as its own family, never as a document', () =>
    {
        expect(familyOfMimeType('application/pdf')).toBe('pdfs');
    });

    it('classifies every mime in the archive set as archives', () =>
    {
        for(const mime of ARCHIVE_MIME_TYPES)
        {
            expect(familyOfMimeType(mime)).toBe('archives');
        }
    });

    // The one deliberate mime-family tie: playlist mimes also match audio's prefix, and playlists must win it, or
    // the Type column and filter would call every playlist "Audio" -- the exact ambiguity the family exists to end.
    it('classifies the m3u mimes as playlists, never as audio', () =>
    {
        expect(familyOfMimeType('audio/x-mpegurl')).toBe('playlists');
        expect(familyOfMimeType('audio/mpegurl')).toBe('playlists');
        expect(familyOfMimeType('application/vnd.apple.mpegurl')).toBe('playlists');
        expect(familyOfMimeType('audio/mpeg')).toBe('audio');
    });

    it('returns null for a mime that belongs to no family', () =>
    {
        expect(familyOfMimeType('application/octet-stream')).toBeNull();
        expect(familyOfMimeType('')).toBeNull();
    });
});

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
