//----------------------------------------------------------------------------------------------------------------------
// Media Tag Spec Support
//
// A hand-built ID3v2.3 tag so extraction specs parse REAL bytes instead of mocking the parser: 10-byte header with
// a synchsafe size, then one text frame per tag (plain big-endian sizes in v2.3, latin1 text with its encoding
// byte), then a token MPEG frame header and padding so the buffer reads as a file and not a bare tag.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------

function id3Frame(id : string, text : string) : Buffer
{
    const body = Buffer.concat([ Buffer.from([ 0 ]), Buffer.from(text, 'latin1') ]);
    const header = Buffer.alloc(10);
    header.write(id, 0, 'latin1');
    header.writeUInt32BE(body.length, 4);

    return Buffer.concat([ header, body ]);
}

export interface TestTags
{
    title ?: string;
    artist ?: string;
    album ?: string;
}

export function taggedMp3(tags : TestTags) : Buffer
{
    const frames : Buffer[] = [];
    if(tags.title !== undefined) { frames.push(id3Frame('TIT2', tags.title)); }
    if(tags.artist !== undefined) { frames.push(id3Frame('TPE1', tags.artist)); }
    if(tags.album !== undefined) { frames.push(id3Frame('TALB', tags.album)); }

    const body = Buffer.concat(frames);
    const size = body.length;
    const header = Buffer.from([
        0x49,
        0x44,
        0x33,
        3,
        0,
        0,
        (size >> 21) & 0x7f,
        (size >> 14) & 0x7f,
        (size >> 7) & 0x7f,
        size & 0x7f,
    ]);

    return Buffer.concat([ header, body, Buffer.from([ 0xff, 0xfb, 0x90, 0x00 ]), Buffer.alloc(64) ]);
}

//----------------------------------------------------------------------------------------------------------------------
