//----------------------------------------------------------------------------------------------------------------------
// Claim Engine -- proof-of-possession answer
//
// The answer must match what the server computes for the same challenge: HMAC-SHA256 keyed by the nonce string, over
// the sampled window bytes concatenated in order, hex. The expected value is derived here with node's createHmac the
// exact way the server's blob-flow support does -- so a drift between the two implementations fails this parity check.
//----------------------------------------------------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { computeProofAnswer } from '@client/engines/claim.ts';

//----------------------------------------------------------------------------------------------------------------------

// The server's reference: key by the nonce string, update each window's bytes in order, digest hex.
function serverAnswer(nonce : string, windows : Uint8Array[]) : string
{
    const hmac = createHmac('sha256', nonce);
    for(const window of windows) { hmac.update(window); }

    return hmac.digest('hex');
}

function buffersOf(...windows : Uint8Array[]) : ArrayBuffer[]
{
    return windows.map((window) =>
    {
        const copy = new Uint8Array(window.byteLength);
        copy.set(window);

        return copy.buffer;
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('computeProofAnswer', () =>
{
    it('matches the server HMAC over a single window', async () =>
    {
        const nonce = 'a1b2c3d4';
        const window = new Uint8Array([ 0x61, 0x62, 0x63, 0x64 ]);

        const answer = await computeProofAnswer(nonce, buffersOf(window));

        expect(answer).toBe(serverAnswer(nonce, [ window ]));
    });

    it('concatenates multiple windows in the order given', async () =>
    {
        const nonce = 'deadbeef';
        const first = new Uint8Array([ 1, 2, 3 ]);
        const second = new Uint8Array([ 250, 251 ]);
        const third = new Uint8Array([ 42 ]);

        const answer = await computeProofAnswer(nonce, buffersOf(first, second, third));

        expect(answer).toBe(serverAnswer(nonce, [ first, second, third ]));
    });

    it('is order-sensitive -- swapping windows changes the answer', async () =>
    {
        const nonce = 'nonce';
        const first = new Uint8Array([ 1, 2 ]);
        const second = new Uint8Array([ 3, 4 ]);

        const forward = await computeProofAnswer(nonce, buffersOf(first, second));
        const reversed = await computeProofAnswer(nonce, buffersOf(second, first));

        expect(forward).not.toBe(reversed);
    });

    it('keys on the nonce -- a different nonce yields a different answer', async () =>
    {
        const window = new Uint8Array([ 9, 9, 9 ]);

        const one = await computeProofAnswer('nonce-one', buffersOf(window));
        const two = await computeProofAnswer('nonce-two', buffersOf(window));

        expect(one).not.toBe(two);
    });

    it('produces the empty-message HMAC when there are no windows', async () =>
    {
        const nonce = 'empty';

        const answer = await computeProofAnswer(nonce, []);

        expect(answer).toBe(serverAnswer(nonce, []));
    });
});

//----------------------------------------------------------------------------------------------------------------------
