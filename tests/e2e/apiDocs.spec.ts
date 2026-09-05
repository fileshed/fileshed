//----------------------------------------------------------------------------------------------------------------------
// E2E — API reference surface
//
// Two servers, because the guarantee has two halves and only a real process can show either.
//
// A deployment serves the OpenAPI document and nothing else. The interactive reference is a page that loads a bundle
// and offers to call this API from it, and there is no setting that turns it on -- it is reachable only by a flag on
// the command line, which is somewhere a configuration file copied between deployments cannot reach.
//
// Asked for, it is this instance's own script and no one else's: the whole reason the flag exists is that the page was
// previously anonymous and fetched its bundle from a CDN, so whoever controlled that URL had script on this origin.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let deployed : ServerHandle;
let withReference : ServerHandle;

beforeAll(async () =>
{
    deployed = await spawnServer();
    withReference = await spawnServer({ args: [ '--api-reference' ] });
});

afterAll(async () =>
{
    await deployed?.stop();
    await withReference?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('a deployment', () =>
{
    it('serves the OpenAPI document to anyone who asks', async () =>
    {
        const res = await new ApiClient(deployed.baseURL).get('/api/openapi.json');

        expect(res.status).toBe(200);
        expect((await res.json() as { openapi ?: string }).openapi).toMatch(/^3\./);
    });

    it('does not serve the interactive reference, or the bundle behind it', async () =>
    {
        const page = await fetch(`${ deployed.baseURL }/api/docs`);
        await page.arrayBuffer();
        expect(page.status).toBe(404);

        const bundle = await fetch(`${ deployed.baseURL }/scalar/standalone.js`);
        await bundle.arrayBuffer();
        expect(bundle.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('a server asked for the reference at the command line', () =>
{
    it('serves it, running no script but this origin\'s own', async () =>
    {
        const res = await fetch(`${ withReference.baseURL }/api/docs`);
        const html = await res.text();

        expect(res.status).toBe(200);

        const sources = [ ...html.matchAll(/<script[^>]+src="([^"]+)"/g) ].map((match) => match[1] ?? '');
        expect(sources.length).toBeGreaterThan(0);
        for(const source of sources)
        {
            expect(source.startsWith('/')).toBe(true);
        }
    });

    it('serves the reference bundle from the instance itself', async () =>
    {
        const res = await fetch(`${ withReference.baseURL }/scalar/standalone.js`);
        const bytes = await res.arrayBuffer();

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type') ?? '').toMatch(/javascript/);
        expect(bytes.byteLength).toBeGreaterThan(1000);
    });
});

//----------------------------------------------------------------------------------------------------------------------
