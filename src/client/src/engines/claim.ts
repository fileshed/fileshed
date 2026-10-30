//----------------------------------------------------------------------------------------------------------------------
// Claim Engine
//
// The proof-of-possession answer must match what the server computes: HMAC-SHA256 keyed by the challenge nonce, over
// the sampled windows concatenated in the order the challenge listed them, as hex. crypto.subtle runs only over those
// small windows, never the whole file, so the rule against subtle.digest for content hashing doesn't apply.
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

export async function calculateProofAnswer(nonce : string, windows : readonly ArrayBuffer[]) : Promise<string>
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
