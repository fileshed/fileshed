//----------------------------------------------------------------------------------------------------------------------
// API Request Helper
//
// The contract every resource-access module leans on: a credentialed fetch, a validated 2xx body, a typed APIError on
// any non-2xx (with regulation codes surfaced as RegulationAPIError), void on a 204, and a loud failure -- never silent
// acceptance -- when a body is unparseable or fails its codec.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Under test
import { requestJSON, requestUpload, requestVoid } from '@client/resource-access/request.ts';
import { APIError, RegulationAPIError } from '@client/resource-access/apiError.ts';

//----------------------------------------------------------------------------------------------------------------------

const okCodec = z.strictObject({ ok: z.boolean() });

function jsonResponse(status : number, body : unknown) : Response
{
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() =>
{
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
});

afterEach(() =>
{
    vi.unstubAllGlobals();
});

//----------------------------------------------------------------------------------------------------------------------

describe('requestJSON', () =>
{
    it('returns the codec-validated body on a 2xx response', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

        const result = await requestJSON('/api/thing', { codec: okCodec });

        expect(result).toEqual({ ok: true });
    });

    it('sends the session cookie with every request', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

        await requestJSON('/api/thing', { codec: okCodec });

        expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
    });

    it('throws an APIError carrying the status and the server error message on a non-2xx', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(403, { error: 'You may not do that.' }));

        const error = await requestJSON('/api/thing', { codec: okCodec }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(APIError);
        expect((error as APIError).status).toBe(403);
        expect((error as APIError).message).toBe('You may not do that.');
    });

    it('surfaces regulation violation codes as a RegulationAPIError on a 422', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(422, {
            error: 'Over quota.',
            violations: [ { code: 'quota.exceeded', message: 'Over quota.' } ],
        }));

        const error = await requestJSON('/api/thing', { codec: okCodec }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(RegulationAPIError);
        expect((error as RegulationAPIError).status).toBe(422);
        expect((error as RegulationAPIError).hasCode('quota.exceeded')).toBe(true);
        expect((error as RegulationAPIError).codes()).toEqual([ 'quota.exceeded' ]);
    });

    it('throws a sensible APIError when a 2xx body is not valid JSON', async () =>
    {
        fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));

        const error = await requestJSON('/api/thing', { codec: okCodec }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(APIError);
        expect((error as APIError).status).toBe(200);
        expect((error as APIError).message).toMatch(/JSON/);
    });

    it('rejects rather than silently accepting a body that fails the codec', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(200, { ok: 'yes-please' }));

        const error = await requestJSON('/api/thing', { codec: okCodec }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(z.ZodError);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('requestVoid', () =>
{
    it('resolves void on a 204 without parsing a body', async () =>
    {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await expect(requestVoid('/api/thing', { method: 'DELETE' })).resolves.toBeUndefined();
    });

    it('throws an APIError on a non-2xx', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Gone.' }));

        const error = await requestVoid('/api/thing', { method: 'POST' }).catch((err : unknown) => err);

        expect(error).toBeInstanceOf(APIError);
        expect((error as APIError).status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('requestUpload', () =>
{
    it('sends the raw body unserialized and returns the validated response', async () =>
    {
        fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
        const body = new Blob([ 'file-bytes' ]);

        const result = await requestUpload('/api/uploads/ticket', { body, codec: okCodec });

        expect(result).toEqual({ ok: true });
        const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
        expect(init.method).toBe('PUT');
        expect(init.body).toBe(body);
    });
});

//----------------------------------------------------------------------------------------------------------------------
