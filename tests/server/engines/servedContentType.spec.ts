//----------------------------------------------------------------------------------------------------------------------
// Served Content Type
//
// The rule that keeps FileShed a file store rather than somewhere to host a site: what renders in place is a photo, a
// track, a clip or a document, and everything else is handed over as plain text. The cases worth writing down are the
// ones a denylist would have got wrong -- a type nobody thought of, a type wearing parameters, a type that is an image
// by family and a document by capability.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import { PLAIN_TEXT_MIME_TYPE } from '@fileshed/core';

// Engines
import { servedContentType } from '@server/engines/servedContentType.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('servedContentType', () =>
{
    it.each([
        [ 'image/png' ],
        [ 'image/jpeg' ],
        [ 'audio/mpeg' ],
        [ 'video/mp4' ],
        [ 'application/pdf' ],
    ])('renders %s as itself', (mimeType) =>
    {
        expect(servedContentType(mimeType, 'inline')).toBe(mimeType);
    });

    it.each([
        [ 'text/html' ],
        [ 'application/xhtml+xml' ],
        [ 'text/css' ],
        [ 'application/javascript' ],
        [ 'text/javascript' ],
        [ 'application/x-shockwave-flash' ],
    ])('serves %s as plain text rather than letting a browser act on it', (mimeType) =>
    {
        expect(servedContentType(mimeType, 'inline')).toBe(PLAIN_TEXT_MIME_TYPE);
    });

    // SVG renders, and the reasoning matters more than the assertion. It carries script, so a browser loading one as
    // a top-level document runs it -- which the sandbox policy on every user-content response is what prevents.
    // Referenced as an ordinary image it executes nothing by specification. Serving it as text would break hotlinked
    // logos to defend a case that is already shut.
    // XHTML above is the contrast: also XML-shaped, also scriptable, and it stays on plain text because unlike a
    // logo or a diagram it has no render case worth keeping.
    it('renders SVG as an image, leaving the sandbox policy to handle the document case', () =>
    {
        expect(servedContentType('image/svg+xml', 'inline')).toBe('image/svg+xml');
    });

    it('sees through parameters and casing', () =>
    {
        expect(servedContentType('TEXT/HTML', 'inline')).toBe(PLAIN_TEXT_MIME_TYPE);
        expect(servedContentType('text/html; charset=utf-8', 'inline')).toBe(PLAIN_TEXT_MIME_TYPE);
        expect(servedContentType('IMAGE/PNG', 'inline')).toBe('IMAGE/PNG');
    });

    // The safelist is the point: a format nobody has heard of gets plain text rather than the benefit of the doubt,
    // which is what a list of dangerous types could never promise.
    it('serves a type it has never heard of as plain text', () =>
    {
        expect(servedContentType('application/vnd.some-vendor.thing', 'inline')).toBe(PLAIN_TEXT_MIME_TYPE);
    });

    // A download is saved rather than rendered, so nothing executes and the user keeps a correctly-typed file.
    it('leaves an attachment under its own type, whatever it is', () =>
    {
        expect(servedContentType('text/html', 'attachment')).toBe('text/html');
        expect(servedContentType('application/zip', 'attachment')).toBe('application/zip');
    });
});

//----------------------------------------------------------------------------------------------------------------------
