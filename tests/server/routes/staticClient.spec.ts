//----------------------------------------------------------------------------------------------------------------------
// Static Client Serving — the production single-image mode
//
// The contract: with a clientDist configured, built assets serve as themselves, any non-API path falls back to
// index.html (the SPA router owns it), and the /api and /d surfaces keep their JSON 404s -- a fallback that turned a
// mistyped API route or a dead direct-link token into a 200 text/html would poison every client error path. Without
// a clientDist (development), nothing changes.
//----------------------------------------------------------------------------------------------------------------------

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// App
import { createApp } from '@server/app.ts';

//----------------------------------------------------------------------------------------------------------------------

const ORIGIN = 'http://localhost:3000';

let distDir : string;
let clientDist : string;

beforeEach(async () =>
{
    distDir = await mkdtemp(join(tmpdir(), 'fileshed-dist-'));
    await writeFile(join(distDir, 'index.html'), '<!doctype html><title>FileShed</title>');
    await writeFile(join(distDir, 'app.js'), 'console.log("built asset");');

    // serve-static resolves its root from the working directory, exactly as the Docker image configures it.
    clientDist = relative(process.cwd(), distDir);
});

afterEach(async () =>
{
    await rm(distDir, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('static client serving', () =>
{
    it('serves built assets as themselves', async () =>
    {
        const app = createApp(undefined, undefined, { clientDist });

        const res = await app.request(`${ ORIGIN }/app.js`);

        expect(res.status).toBe(200);
        expect(await res.text()).toContain('built asset');
    });

    it('falls back to index.html for SPA routes, deep links included', async () =>
    {
        const app = createApp(undefined, undefined, { clientDist });

        for(const path of [ '/', '/folder/abc123', '/account/tokens' ])
        {
            // eslint-disable-next-line no-await-in-loop -- three sequential probes of one app
            const res = await app.request(`${ ORIGIN }${ path }`);

            expect(res.status, path).toBe(200);
            // eslint-disable-next-line no-await-in-loop -- same probe
            expect(await res.text(), path).toContain('FileShed');
        }
    });

    it('keeps JSON 404s on the API and direct-link surfaces', async () =>
    {
        const app = createApp(undefined, undefined, { clientDist });

        for(const path of [ '/api/no-such-route', '/d/no-such-token' ])
        {
            // eslint-disable-next-line no-await-in-loop -- two sequential probes of one app
            const res = await app.request(`${ ORIGIN }${ path }`);

            expect(res.status, path).toBe(404);
            // eslint-disable-next-line no-await-in-loop -- same probe
            expect(await res.json(), path).toEqual({ error: 'Not Found' });
        }
    });

    it('changes nothing when no client directory is configured', async () =>
    {
        const app = createApp();

        const res = await app.request(`${ ORIGIN }/folder/abc123`);

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not Found' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
