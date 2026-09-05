//----------------------------------------------------------------------------------------------------------------------
// Content Security Policy
//
// Asserted on the response rather than read off the constant: a policy that quietly stops being applied looks exactly
// like one that was never written. What the app needs in order to keep working under it -- inline style, a WebAssembly
// compile, blob: images -- only a browser can confirm; what this file holds is the part the policy exists for. Script
// comes from this origin, and from nowhere else.
//----------------------------------------------------------------------------------------------------------------------

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// App
import { createApp } from '@server/app.ts';

//----------------------------------------------------------------------------------------------------------------------

const ORIGIN = 'http://localhost:3000';

let distDir : string;
let clientDist : string;

beforeAll(async () =>
{
    distDir = await mkdtemp(join(tmpdir(), 'fileshed-csp-'));
    await writeFile(join(distDir, 'index.html'), '<!doctype html><title>FileShed</title>');

    clientDist = relative(process.cwd(), distDir);
});

afterAll(async () =>
{
    await rm(distDir, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

function directivesOf(policy : string | null) : Map<string, string[]>
{
    const parsed = new Map<string, string[]>();

    for(const part of (policy ?? '').split(';'))
    {
        const [ name, ...sources ] = part.trim().split(/\s+/u);
        if(name !== undefined && name !== '') { parsed.set(name, sources); }
    }

    return parsed;
}

// The SPA document itself -- the response the issue is about, served the way the packaged image serves it.
async function documentPolicy() : Promise<Map<string, string[]>>
{
    const res = await createApp(undefined, undefined, { clientDist }).request(`${ ORIGIN }/folder/abc123`);

    return directivesOf(res.headers.get('content-security-policy'));
}

//----------------------------------------------------------------------------------------------------------------------

describe('the app document policy', () =>
{
    it('serves the app document under a policy at all', async () =>
    {
        const policy = await documentPolicy();

        expect(policy.get('default-src')).toEqual([ "'self'" ]);
    });

    it('lets script come from this origin and nowhere else', async () =>
    {
        const sources = (await documentPolicy()).get('script-src') ?? [];

        // A keyword is quoted; anything unquoted is a host or a scheme, and a scheme source is every host on it.
        expect(sources.filter((source) => !source.startsWith("'"))).toEqual([]);
        expect(sources).toContain("'self'");
    });

    it('admits neither inline script nor eval', async () =>
    {
        const sources = (await documentPolicy()).get('script-src') ?? [];

        expect(sources).not.toContain("'unsafe-inline'");
        expect(sources).not.toContain("'unsafe-eval'");
    });

    it('keeps the WebAssembly compile the upload hasher runs on', async () =>
    {
        const sources = (await documentPolicy()).get('script-src') ?? [];

        // hash-wasm compiles its SHA-256 module from bytes; without this every upload dies before one moves.
        expect(sources).toContain("'wasm-unsafe-eval'");
    });

    it('closes the embedding surfaces the app has no use for', async () =>
    {
        const policy = await documentPolicy();

        expect(policy.get('object-src')).toEqual([ "'none'" ]);
        expect(policy.get('frame-src')).toEqual([ "'none'" ]);
        expect(policy.get('frame-ancestors')).toEqual([ "'none'" ]);
        expect(policy.get('base-uri')).toEqual([ "'self'" ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
