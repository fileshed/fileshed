//----------------------------------------------------------------------------------------------------------------------
// Served Content Types
//
// FileShed stores files; it does not host sites. The types below are the ones worth rendering in place -- a photo, a
// track, a clip, a document -- and everything else is handed to the browser as plain text when it is asked to render
// it. That is the whole rule, and it is a safelist rather than a list of dangerous types on purpose: a denylist has
// to be right about every format a browser will ever execute, and it is wrong the moment one is added.
//----------------------------------------------------------------------------------------------------------------------

// Whole families, because a photo is a photo whatever the container.
//
// SVG is in, deliberately, and it is the one entry that needs its reasoning written down: it carries script, so a
// browser that loads one as a top-level document will run it. What makes that safe is the sandbox policy every
// user-content response carries, which drops such a document into an opaque origin with no scripting -- verified in a
// browser rather than assumed. Referenced as an ordinary image it was never a hazard at all; SVG-in-`<img>` executes
// nothing by specification. Serving it as text instead would cost hotlinked logos and diagrams to defend a case that
// is already shut, so the answer is to keep the sandbox policy honest rather than to refuse the format.
export const renderableMimeFamilies = [ 'image/', 'audio/', 'video/' ] as const;

// Renderable formats that are not a whole family.
export const renderableMimeTypes = [ 'application/pdf' ] as const;

// What anything else is served as when the caller asked to see it. Plain text renders in every browser, executes in
// none, and still lets somebody read a file rather than being made to download it first. Everything genuinely
// executable lands here -- html, xhtml, css, javascript -- and none of it has a render case worth preserving.
export const PLAIN_TEXT_MIME_TYPE = 'text/plain; charset=utf-8';

//----------------------------------------------------------------------------------------------------------------------
