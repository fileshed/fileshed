//----------------------------------------------------------------------------------------------------------------------
// Image Byte Fixtures
//
// Bytes that open the way each image format opens, with a caller-chosen marker riding behind the header so two
// fixtures of the same format hash differently -- which is what the avatar and logo lifecycle specs need to tell one
// upload from the next.
//
// REAL_PNG is a complete 1x1 file rather than a shaped prefix: a sniffer that only ever sees fixtures built to its own
// rules has been tested against itself.
//----------------------------------------------------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);
const JPEG_MAGIC = Buffer.from([ 0xff, 0xd8, 0xff, 0xe0 ]);
const GIF_MAGIC = Buffer.from('GIF89a', 'ascii');
const BMP_MAGIC = Buffer.from('BM', 'ascii');
const ICO_MAGIC = Buffer.from([ 0x00, 0x00, 0x01, 0x00 ]);

//----------------------------------------------------------------------------------------------------------------------

export const REAL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

//----------------------------------------------------------------------------------------------------------------------

function shaped(magic : Buffer, marker : string) : Buffer
{
    return Buffer.concat([ magic, Buffer.from(marker, 'utf8') ]);
}

export function pngBytes(marker = '') : Buffer
{
    return shaped(PNG_MAGIC, marker);
}

export function jpegBytes(marker = '') : Buffer
{
    return shaped(JPEG_MAGIC, marker);
}

export function gifBytes(marker = '') : Buffer
{
    return shaped(GIF_MAGIC, marker);
}

export function bmpBytes(marker = '') : Buffer
{
    return shaped(BMP_MAGIC, marker);
}

export function icoBytes(marker = '') : Buffer
{
    return shaped(ICO_MAGIC, marker);
}

// RIFF names its payload four bytes in, so a WebP fixture needs a plausible chunk size between the two tags.
export function webpBytes(marker = '') : Buffer
{
    const payload = Buffer.from(`VP8L${ marker }`, 'utf8');
    const size = Buffer.alloc(4);
    size.writeUInt32LE(payload.length + 4);

    return Buffer.concat([ Buffer.from('RIFF', 'ascii'), size, Buffer.from('WEBP', 'ascii'), payload ]);
}

export function svgBytes(marker = '') : Buffer
{
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><title>${ marker }</title></svg>`, 'utf8');
}

//----------------------------------------------------------------------------------------------------------------------
