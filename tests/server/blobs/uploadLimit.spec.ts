//----------------------------------------------------------------------------------------------------------------------
// Upload Size Ceiling
//
// Both refusals a file can meet for being too large -- at the claim, and at a PUT against a ticket the cap moved out
// from under -- and what each one tells the client. A bare "too large" is useless to whoever picked the file: the
// answer carries the ceiling it was measured against, in our own body and in the Upload-Limit field of the IETF
// resumable-uploads draft, and both must report the live setting rather than anything frozen at boot.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

// Support
import { type BootedBlobApp, bootBlobApp, claim, makeUser, putUpload } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedBlobApp;

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// The max-size member of an Upload-Limit dictionary, as an integer. The draft's field is a Structured Fields
// Dictionary whose max-size value is an Integer, so a client reads the number back out of the header text.
function maxSizeOf(header : string | null) : number | null
{
    const match = /(?:^|[,\s])max-size=(\d+)(?:$|[;,\s])/.exec(header ?? '');

    return match?.[1] === undefined ? null : Number(match[1]);
}

//----------------------------------------------------------------------------------------------------------------------

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('a claim for a file over the ceiling', () =>
{
    it('refuses with the ceiling in the body and in the Upload-Limit header', async () =>
    {
        const maxBytes = 1024;
        booted = await bootBlobApp({ uploadMaxBytes: async () => maxBytes });
        const user = await makeUser(booted, 'oversized@example.com');

        const res = await claim(booted.app, user.cookie, sha256Of(randomBytes(32)), maxBytes + 1);

        expect(res.status).toBe(413);
        expect(await res.json() as { maxBytes : number }).toMatchObject({ maxBytes });
        expect(maxSizeOf(res.headers.get('upload-limit'))).toBe(maxBytes);
    });

    // The cap is read per request, so the number the refusal quotes is the one in force when it was refused -- an
    // admin who lowers it mid-session gets the new figure shown to the next person who trips over it.
    it('quotes the ceiling in force at the moment of the refusal', async () =>
    {
        let maxBytes = 4096;
        booted = await bootBlobApp({ uploadMaxBytes: async () => maxBytes });
        const user = await makeUser(booted, 'moving-cap@example.com');

        const first = await claim(booted.app, user.cookie, sha256Of(randomBytes(32)), 8192);
        expect(await first.json() as { maxBytes : number }).toMatchObject({ maxBytes: 4096 });

        maxBytes = 2048;

        const second = await claim(booted.app, user.cookie, sha256Of(randomBytes(32)), 8192);
        expect(await second.json() as { maxBytes : number }).toMatchObject({ maxBytes: 2048 });
        expect(maxSizeOf(second.headers.get('upload-limit'))).toBe(2048);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('an upload against a ticket the ceiling dropped below', () =>
{
    // A ticket issued under one cap and spent under a lower one: the bytes are refused on arrival, and the answer
    // quotes the cap that refused them, not the one the ticket was issued under.
    it('refuses with the new ceiling in the body and in the Upload-Limit header', async () =>
    {
        let maxBytes = 1024 * 1024;
        booted = await bootBlobApp({ uploadMaxBytes: async () => maxBytes });
        const user = await makeUser(booted, 'lowered@example.com');

        const data = randomBytes(4096);
        const claimed = await claim(booted.app, user.cookie, sha256Of(data), data.length);
        expect(claimed.status).toBe(200);

        const { ticket } = await claimed.json() as { ticket : string };

        maxBytes = 2048;

        const res = await putUpload(booted.app, user.cookie, ticket, data);

        expect(res.status).toBe(413);
        expect(await res.json() as { maxBytes : number }).toMatchObject({ maxBytes: 2048 });
        expect(maxSizeOf(res.headers.get('upload-limit'))).toBe(2048);
    });
});

//----------------------------------------------------------------------------------------------------------------------
