//----------------------------------------------------------------------------------------------------------------------
// Outstanding Upload Claims — what a ticket costs its owner before a byte lands
//
// A claim is a hold, not a question. It entitles the client to put its claimed size into staging, and nothing charges
// the account for those bytes until the file commits -- so a claim judged against committed usage alone is judged
// against zero, and every member of a batch is admitted against the same zero. Two rules follow, and this drives both
// through the real routes: what an account is already holding counts against its quota, and an account may only hold
// so many claims at once however small they are.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaimResponse } from '@fileshed/core';

// Support
import { type BootedBlobApp, ORIGIN, bootBlobApp, claim, makeUser, putUpload } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const KILOBYTE = 1024;

let booted : BootedBlobApp;

beforeEach(async () =>
{
    booted = await bootBlobApp();
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// A claim for bytes that exist but are never delivered: the hold is what these specs are about, not the upload.
async function claimBytes(cookie : string, size : number) : Promise<Response>
{
    return claim(booted.app, cookie, sha256Of(randomBytes(size)), size);
}

async function ticketFrom(response : Response) : Promise<string>
{
    const body = await response.json() as ClaimResponse;
    if(body.upload !== true) { throw new Error('expected an upload ticket'); }

    return body.ticket;
}

//----------------------------------------------------------------------------------------------------------------------
// Quota
//----------------------------------------------------------------------------------------------------------------------

describe('claim admission against outstanding claims', () =>
{
    it('refuses a claim whose bytes will not fit beside one the account is already holding', async () =>
    {
        const user = await makeUser(booted, 'holder@example.com', 2 * KILOBYTE);

        const first = await claimBytes(user.cookie, 2 * KILOBYTE);
        const second = await claimBytes(user.cookie, KILOBYTE);
        const body = await second.json() as { error : string };

        expect(first.status).toBe(200);
        expect(second.status).toBe(403);
        expect(body.error.toLowerCase()).toContain('quota');
    });

    it('admits a batch of claims that fit together', async () =>
    {
        const user = await makeUser(booted, 'roomy@example.com', 2 * KILOBYTE);

        const first = await claimBytes(user.cookie, KILOBYTE);
        const second = await claimBytes(user.cookie, KILOBYTE);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
    });

    // The hold and the charge are the same bytes counted at two different moments, never both at once: a committed
    // upload stops being a hold the instant it becomes usage.
    it('counts a committed upload once, so the same bytes claimed and stored do not lock the account out', async () =>
    {
        const user = await makeUser(booted, 'committer@example.com', 2 * KILOBYTE);
        const data = randomBytes(KILOBYTE);

        const ticket = await ticketFrom(await claim(booted.app, user.cookie, sha256Of(data), data.length));
        expect((await putUpload(booted.app, user.cookie, ticket, data)).status).toBe(200);

        expect((await claimBytes(user.cookie, KILOBYTE)).status).toBe(200);
    });

    // Handing the ticket to a commit spends it -- no second request will be honoured against it -- but the bytes it
    // claimed are still arriving. Releasing the hold there would let a client claim its quota over and over simply by
    // starting each upload and never finishing it.
    it('holds the bytes of an upload that is still streaming', async () =>
    {
        const user = await makeUser(booted, 'streamer@example.com', 2 * KILOBYTE);
        const data = randomBytes(2 * KILOBYTE);

        const ticket = await ticketFrom(await claim(booted.app, user.cookie, sha256Of(data), data.length));

        const reading = Promise.withResolvers<null>();
        const rest = Promise.withResolvers<null>();

        let opened = false;
        const body = new ReadableStream<Uint8Array>({
            async pull(controller)
            {
                if(!opened)
                {
                    opened = true;
                    controller.enqueue(new Uint8Array(data.subarray(0, KILOBYTE)));
                    reading.resolve(null);
                    return;
                }

                await rest.promise;
                controller.enqueue(new Uint8Array(data.subarray(KILOBYTE)));
                controller.close();
            },
        });

        const params = new URLSearchParams({ name: 'slow.bin', mimeType: 'application/octet-stream' });
        const upload = booted.app.request(`${ ORIGIN }/api/uploads/${ ticket }?${ params.toString() }`, {
            method: 'PUT',
            headers: { 'cookie': user.cookie, 'content-length': String(data.length) },
            body,
            duplex: 'half',
        } as RequestInit);

        await reading.promise;
        const during = await claimBytes(user.cookie, KILOBYTE);

        rest.resolve(null);
        const settled = await upload;

        expect(during.status).toBe(403);
        expect(settled.status).toBe(200);
    });

    it('releases a hold whose claim has expired, so an abandoned upload does not cap the account forever', async () =>
    {
        const user = await makeUser(booted, 'abandoner@example.com', 2 * KILOBYTE);

        vi.useFakeTimers({ toFake: [ 'Date' ] });
        try
        {
            expect((await claimBytes(user.cookie, 2 * KILOBYTE)).status).toBe(200);
            expect((await claimBytes(user.cookie, KILOBYTE)).status).toBe(403);

            // Tickets live 30 minutes. Past that the abandoned claim can never be uploaded against, so what it was
            // holding is not holding anything.
            vi.setSystemTime(new Date(Date.now() + (31 * 60 * 1000)));

            expect((await claimBytes(user.cookie, 2 * KILOBYTE)).status).toBe(200);
        }
        finally
        {
            vi.useRealTimers();
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Count
//----------------------------------------------------------------------------------------------------------------------

describe('outstanding claim ceiling', () =>
{
    // Each claim costs the client one cheap request and costs the server an entry that stands for the ticket's whole
    // lifetime, so the number of them is capped on its own -- a quota bounds the bytes those tickets may write, and
    // an account with a generous one (or none) would otherwise be free to mint them without limit.
    async function claimUntilRefused(cookie : string, attemptsLeft : number) : Promise<number>
    {
        if(attemptsLeft === 0) { throw new Error('the outstanding-claim ceiling never tripped'); }

        const status = (await claimBytes(cookie, 1)).status;
        if(status !== 200) { return status; }

        return claimUntilRefused(cookie, attemptsLeft - 1);
    }

    it('refuses a further claim once an account is holding the maximum number of them', async () =>
    {
        const user = await makeUser(booted, 'flood@example.com');

        expect(await claimUntilRefused(user.cookie, 500)).toBe(429);
    });

    it('caps each account separately, so one account flooding claims cannot refuse another an upload', async () =>
    {
        const flooder = await makeUser(booted, 'flood-one@example.com');
        const bystander = await makeUser(booted, 'flood-two@example.com');

        expect(await claimUntilRefused(flooder.cookie, 500)).toBe(429);

        expect((await claimBytes(bystander.cookie, KILOBYTE)).status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
