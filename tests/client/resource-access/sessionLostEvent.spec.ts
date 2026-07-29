//----------------------------------------------------------------------------------------------------------------------
// Session-Lost Announcement — the 401 tripwire in the request primitive
//
// Every credentialed request flows through requestJson/requestVoid; a 401 anywhere means the session died, and the
// primitive announces it as a window event (the router-side listener owns the reaction). Any other failure -- 403,
// 404, 500 -- is that call's own problem and must NOT announce, or a permission refusal would sign people out.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Under test
import { SESSION_LOST_EVENT, requestJson } from '@client/resource-access/request.ts';

//----------------------------------------------------------------------------------------------------------------------

function jsonResponse(status : number, body : unknown) : Response
{
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

let fired : number;
const listener = () : void => { fired += 1; };

//----------------------------------------------------------------------------------------------------------------------

describe('the session-lost announcement', () =>
{
    beforeEach(() =>
    {
        fired = 0;
        window.addEventListener(SESSION_LOST_EVENT, listener);
    });

    afterEach(() =>
    {
        window.removeEventListener(SESSION_LOST_EVENT, listener);
        vi.restoreAllMocks();
    });

    it('fires on a 401 and still throws the ApiError to the caller', async () =>
    {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, { error: 'No session.' }));

        await expect(requestJson('/api/me', { codec: z.unknown() })).rejects.toThrow('No session.');
        expect(fired).toBe(1);
    });

    it('stays silent on other failures -- a 403 is a refusal, not a dead session', async () =>
    {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(403, { error: 'Not yours.' }));

        await expect(requestJson('/api/admin/users', { codec: z.unknown() })).rejects.toThrow('Not yours.');
        expect(fired).toBe(0);
    });

    it('stays silent on success', async () =>
    {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { fine: true }));

        await requestJson('/api/health', { codec: z.unknown() });
        expect(fired).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
