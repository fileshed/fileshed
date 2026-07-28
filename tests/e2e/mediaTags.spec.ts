//----------------------------------------------------------------------------------------------------------------------
// E2E — Media tags over real sockets
//
// Upload a real ID3-tagged file over HTTP and find it by artist through GET /api/search, proving the whole tier-2
// chain live: the upload route's background enrichment, the content-keyed row, and the search join. Enrichment is
// deliberately fire-and-forget, so the search is polled briefly rather than assumed instantaneous.
//----------------------------------------------------------------------------------------------------------------------

import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ClaimResponse, NodeListResponse, NodeResponse } from '@fileshed/core';

// Support
import { taggedMp3 } from '../server/mediaTags/support.ts';
import { ApiClient, type ServerHandle, sha256Of, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let server : ServerHandle;
let owner : ApiClient;

beforeAll(async () =>
{
    server = await spawnServer();
    owner = new ApiClient(server.baseURL);
    await owner.signUp('tagged@example.com', 'correct-horse-battery');
});

afterAll(async () =>
{
    await server.stop();
});

async function upload(name : string, bytes : Buffer) : Promise<NodeResponse>
{
    const claim = await (await owner.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
        .json() as ClaimResponse;
    if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

    const params = new URLSearchParams({ name, mimeType: 'audio/mpeg' });

    return await (await owner.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes))
        .json() as NodeResponse;
}

async function searchIDs(term : string) : Promise<string[]>
{
    const page = await (await owner.get(`/api/search?q=${ encodeURIComponent(term) }`))
        .json() as NodeListResponse;

    return page.nodes.map((node) => node.id);
}

//----------------------------------------------------------------------------------------------------------------------

describe('media tag enrichment', () =>
{
    it('makes an upload findable by its embedded artist, title, and album', async () =>
    {
        const bytes = taggedMp3({ title: 'Neon Skyline', artist: 'The Sample Band', album: 'Fixtures' });
        const node = await upload('01-track.mp3', bytes);

        // Enrichment runs behind the upload response; give it a moment, then insist.
        let byArtist : string[] = [];
        for(let attempt = 0; attempt < 20 && !byArtist.includes(node.id); attempt += 1)
        {
            // eslint-disable-next-line no-await-in-loop -- polling a deliberately asynchronous background write
            await sleep(50);
            // eslint-disable-next-line no-await-in-loop -- same poll
            byArtist = await searchIDs('sample band');
        }

        expect(byArtist).toContain(node.id);
        expect(await searchIDs('neon skyline')).toContain(node.id);
        expect(await searchIDs('fixtures')).toContain(node.id);
        expect(await searchIDs('zeppelin')).not.toContain(node.id);
    });
});

//----------------------------------------------------------------------------------------------------------------------
