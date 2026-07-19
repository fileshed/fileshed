//----------------------------------------------------------------------------------------------------------------------
// Health Route — smoke tests
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import app from '@server/app.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/health', () =>
{
    it('reports the service is up with a 200 and an ok status', async () =>
    {
        const res = await app.request('/api/health');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
    });
});

describe('unknown routes', () =>
{
    it('respond with a JSON 404 carrying an error message', async () =>
    {
        const res = await app.request('/api/does-not-exist');
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(body).toHaveProperty('error');
    });
});

//----------------------------------------------------------------------------------------------------------------------
