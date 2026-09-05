//----------------------------------------------------------------------------------------------------------------------
// Image Format Sniffing
//
// Expectation: an upload's declared type has to describe the bytes behind it. The avatar and logo stores are
// content-addressed and shared with file content, and both serve their bytes back under the declared type -- so
// anything the sniffer waves through is what the store will later claim to hold.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { type ImageFormat, mimeMatchesBytes, sniffImageFormat } from '@server/engines/imageFormat.ts';

// Support
import {
    REAL_PNG,
    bmpBytes,
    gifBytes,
    icoBytes,
    jpegBytes,
    pngBytes,
    svgBytes,
    webpBytes,
} from '../support/imageBytes.ts';

//----------------------------------------------------------------------------------------------------------------------

const HTML = Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>', 'utf8');

//----------------------------------------------------------------------------------------------------------------------

describe('sniffImageFormat', () =>
{
    it('names each format the avatar and logo whitelists admit', () =>
    {
        const cases : [ Buffer, ImageFormat ][] = [
            [ pngBytes(), 'png' ],
            [ jpegBytes(), 'jpeg' ],
            [ gifBytes(), 'gif' ],
            [ webpBytes(), 'webp' ],
            [ bmpBytes(), 'bmp' ],
            [ icoBytes(), 'ico' ],
            [ svgBytes(), 'svg' ],
        ];

        expect(cases.map(([ bytes ]) => sniffImageFormat(bytes))).toEqual(cases.map(([ , format ]) => format));
    });

    it('names a complete real image, not just a shaped header', () =>
    {
        expect(sniffImageFormat(REAL_PNG)).toBe('png');
    });

    it('names nothing for bytes that are no image at all', () =>
    {
        expect(sniffImageFormat(HTML)).toBeNull();
        expect(sniffImageFormat(Buffer.from('an avatar image, pretend it is a PNG', 'utf8'))).toBeNull();
        expect(sniffImageFormat(Buffer.alloc(0))).toBeNull();
    });

    // A RIFF container holds several payloads and only one of them is an image; the tag four bytes in is what says
    // which, so matching on RIFF alone would admit a WAV as a WebP.
    it('names nothing for a RIFF container that is not WebP', () =>
    {
        const wav = Buffer.concat([ Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WAVE', 'ascii') ]);

        expect(sniffImageFormat(wav)).toBeNull();
    });

    // SVG has no magic number, so the check is that the document opens as XML and reaches an <svg> root. HTML is what
    // an attacker would rather store in an image slot, and it fails both.
    it('names nothing for HTML dressed up with an XML prolog', () =>
    {
        const dressed = Buffer.from('<?xml version="1.0"?><html><body>hi</body></html>', 'utf8');

        expect(sniffImageFormat(dressed)).toBeNull();
    });

    it('names svg for a document opening with a prolog or a doctype ahead of the root', () =>
    {
        const prolog = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="x"/>', 'utf8');
        const doctype = Buffer.from('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg/>', 'utf8');

        expect(sniffImageFormat(prolog)).toBe('svg');
        expect(sniffImageFormat(doctype)).toBe('svg');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('mimeMatchesBytes', () =>
{
    it('accepts bytes under the type they actually are', () =>
    {
        expect(mimeMatchesBytes('image/png', pngBytes())).toBe(true);
        expect(mimeMatchesBytes('image/svg+xml', svgBytes())).toBe(true);
    });

    // The declared type is what the store serves the bytes back under, so a PNG labelled as a GIF would make the
    // store lie about its own contents even though both are images.
    it('refuses recognized bytes declared as another format', () =>
    {
        expect(mimeMatchesBytes('image/gif', pngBytes())).toBe(false);
        expect(mimeMatchesBytes('image/png', svgBytes())).toBe(false);
    });

    it('refuses HTML declared as an image', () =>
    {
        expect(mimeMatchesBytes('image/png', HTML)).toBe(false);
        expect(mimeMatchesBytes('image/svg+xml', HTML)).toBe(false);
    });

    // One container, two registered spellings -- refusing either would refuse a legitimate favicon.
    it('accepts an ICO under both of its registered mime types', () =>
    {
        expect(mimeMatchesBytes('image/x-icon', icoBytes())).toBe(true);
        expect(mimeMatchesBytes('image/vnd.microsoft.icon', icoBytes())).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
