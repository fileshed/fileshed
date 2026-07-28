//----------------------------------------------------------------------------------------------------------------------
// Node Type — mime family classification
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { ARCHIVE_MIME_TYPES, familyOfMimeType } from '@fileshed/core';

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
