//----------------------------------------------------------------------------------------------------------------------
// Media Type Validity
//
// A stored mime type is emitted verbatim as a Content-Type header, so "valid" here means "a header can carry it" --
// the RFC 9110 media-type grammar, which is entirely printable ASCII.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { MIME_TYPE_MAX_LENGTH, isValidMimeType } from '@fileshed/core';

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
