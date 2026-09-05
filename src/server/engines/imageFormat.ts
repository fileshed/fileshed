//----------------------------------------------------------------------------------------------------------------------
// Image Format Sniffing
//
// What bytes actually are, against what an upload claims they are. The avatar and logo stores are content-addressed
// and shared with file content, and both serve their bytes back under the declared type -- so a declaration nothing
// checks means the store holds whatever the uploader felt like, addressed by hash and labelled as an image.
//
// Sniffing is by leading bytes, not by parsing: the question is only whether the container matches the claim.
//----------------------------------------------------------------------------------------------------------------------

export const imageFormats = [ 'png', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg' ] as const;
export type ImageFormat = typeof imageFormats[number];

// The mime types each format may legitimately be declared as. ICO carries two registered spellings for one container,
// which is the whole reason a format sits between the bytes and the mime rather than the sniffer answering a mime.
const FORMAT_MIME_TYPES : Readonly<Record<ImageFormat, readonly string[]>> = {
    png: [ 'image/png' ],
    jpeg: [ 'image/jpeg' ],
    gif: [ 'image/gif' ],
    webp: [ 'image/webp' ],
    bmp: [ 'image/bmp' ],
    ico: [ 'image/x-icon', 'image/vnd.microsoft.icon' ],
    svg: [ 'image/svg+xml' ],
};

const SIGNATURES : readonly { format : ImageFormat; magic : readonly number[] }[] = [
    { format: 'png', magic: [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] },
    { format: 'jpeg', magic: [ 0xff, 0xd8, 0xff ] },
    { format: 'gif', magic: [ 0x47, 0x49, 0x46, 0x38, 0x37, 0x61 ] },
    { format: 'gif', magic: [ 0x47, 0x49, 0x46, 0x38, 0x39, 0x61 ] },
    { format: 'bmp', magic: [ 0x42, 0x4d ] },
    { format: 'ico', magic: [ 0x00, 0x00, 0x01, 0x00 ] },
];

// RIFF containers name their payload four bytes in: WEBP is one of several, and the others are not images.
const RIFF = [ 0x52, 0x49, 0x46, 0x46 ];
const WEBP = [ 0x57, 0x45, 0x42, 0x50 ];

// How far into a text file the SVG check looks: far enough for a prolog and a doctype, not so far that a megabyte of
// prose gets scanned for a root element that was never coming.
const SVG_OPENING_BYTES = 1024;
const SVG_ROOT_BYTES = 4096;

const SVG_OPENERS = [ '<?xml', '<svg', '<!doctype svg' ];

//----------------------------------------------------------------------------------------------------------------------

function startsWith(bytes : Buffer, magic : readonly number[], offset = 0) : boolean
{
    if(bytes.length < offset + magic.length) { return false; }

    return magic.every((byte, index) => bytes[offset + index] === byte);
}

// SVG is XML, so there is no magic number to match -- what distinguishes it from the HTML an attacker would rather
// store is that it opens as XML and its root element is <svg>. A document that opens as anything else (<!DOCTYPE html>,
// <html>, <script>) fails on the opener; one that opens as XML but never reaches an <svg> root fails on the second.
// This says the container is SVG, nothing more -- an SVG's own script surface is unaffected, which is why the logo is
// admin-only and avatars refuse the format outright.
function looksLikeSvg(bytes : Buffer) : boolean
{
    const opening = bytes.subarray(0, SVG_OPENING_BYTES)
        .toString('utf8')
        .trimStart()
        .toLowerCase();

    if(!SVG_OPENERS.some((opener) => opening.startsWith(opener))) { return false; }

    return bytes.subarray(0, SVG_ROOT_BYTES)
        .toString('utf8')
        .toLowerCase()
        .includes('<svg');
}

//----------------------------------------------------------------------------------------------------------------------

export function sniffImageFormat(bytes : Buffer) : ImageFormat | null
{
    for(const { format, magic } of SIGNATURES)
    {
        if(startsWith(bytes, magic)) { return format; }
    }

    if(startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) { return 'webp'; }

    return looksLikeSvg(bytes) ? 'svg' : null;
}

// Whether the bytes are the thing the upload says they are. Unrecognized bytes fail, and so do recognized bytes under
// another format's mime -- the declared type is what gets served back, so it has to describe what is stored.
export function mimeMatchesBytes(mime : string, bytes : Buffer) : boolean
{
    const format = sniffImageFormat(bytes);
    if(format === null) { return false; }

    return FORMAT_MIME_TYPES[format].includes(mime);
}

//----------------------------------------------------------------------------------------------------------------------
