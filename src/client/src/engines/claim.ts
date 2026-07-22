//----------------------------------------------------------------------------------------------------------------------
// Claim Engine
//
// The client-side pure logic of the blob claim protocol. Today that is a single decision: the proof-of-possession
// answer a caller returns when the server already holds a blob and challenges the uploader to prove it actually has the
// bytes rather than just their digest. The answer is HMAC-SHA256, keyed by the challenge nonce, over the sampled window
// bytes concatenated in the order the challenge listed them, hex -- matching what the server computes for the same
// challenge. Pure given its inputs: the windows are read from the file elsewhere and handed in as buffers, so this
// computes and never touches I/O. crypto.subtle runs only over the tiny sampled windows, never the whole file, so the
// ban on subtle.digest for content hashing does not reach it. Future claim-flow decisions that are pure client logic
// belong here too.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------

function toHex(bytes : Uint8Array) : string
{
    return [ ...bytes ].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concat(windows : readonly ArrayBuffer[]) : Uint8Array<ArrayBuffer>
{
    const total = windows.reduce((sum, window) => sum + window.byteLength, 0);
    const message = new Uint8Array(total);

    let offset = 0;
    for(const window of windows)
    {
        message.set(new Uint8Array(window), offset);
        offset += window.byteLength;
    }

    return message;
}

//----------------------------------------------------------------------------------------------------------------------

export async function computeProofAnswer(nonce : string, windows : readonly ArrayBuffer[]) : Promise<string>
{
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(nonce),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        [ 'sign' ]
    );

    const signature = await crypto.subtle.sign('HMAC', key, concat(windows));

    return toHex(new Uint8Array(signature));
}

//----------------------------------------------------------------------------------------------------------------------
