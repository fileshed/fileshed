//----------------------------------------------------------------------------------------------------------------------
// E2E — Boot
//
// A fresh install has to come up without reporting a problem it does not have. The child runs at the suite's error log
// level, so a clean boot writes nothing at all; Node's SQLite experimental warning is switched off the way the image
// switches it off, so stderr is left to whatever the app and its libraries report.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import { type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let server : ServerHandle;

beforeAll(async () =>
{
    server = await spawnServer({ env: { NODE_OPTIONS: '--disable-warning=ExperimentalWarning' } });
});

afterAll(async () =>
{
    await server.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('a first boot over an empty data directory', () =>
{
    it('reports nothing, through the first auth request', async () =>
    {
        // Auth requests wait on whatever better-auth checked as the instance was constructed, so once one answers,
        // anything that check was going to report has been reported.
        const session = await fetch(`${ server.baseURL }/api/auth/get-session`);
        expect(session.status).toBe(200);

        expect(server.output()).toEqual({ stdout: '', stderr: '' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
