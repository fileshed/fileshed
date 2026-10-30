//----------------------------------------------------------------------------------------------------------------------
// Request Path Engine — the path every guard matches against
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { normalizeRequestPath, pathWithin } from '@server/engines/requestPath.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('normalizeRequestPath', () =>
{
    it('decodes percent-encoded characters, since the router matches the decoded path', () =>
    {
        expect(normalizeRequestPath('/%61pi/nodes')).toBe('/api/nodes');
    });

    it('decodes an encoded slash, so it cannot hide a segment boundary', () =>
    {
        expect(normalizeRequestPath('/api/auth/admin%2Flist-users')).toBe('/api/auth/admin/list-users');
    });

    it('collapses repeated slashes and lowercases', () =>
    {
        expect(normalizeRequestPath('/API//Auth///Admin')).toBe('/api/auth/admin');
    });

    it('still decodes the well-formed sequences when another one in the path is malformed', () =>
    {
        expect(normalizeRequestPath('/%61pi/nodes/%E0')).toBe('/api/nodes/%e0');
    });
});

describe('pathWithin', () =>
{
    it('covers the prefix itself and every path beneath it', () =>
    {
        expect(pathWithin('/api', '/api')).toBe(true);
        expect(pathWithin('/api/nodes', '/api')).toBe(true);
    });

    it('does not cover a lookalike that only shares the prefix text', () =>
    {
        expect(pathWithin('/apiary', '/api')).toBe(false);
        expect(pathWithin('/api/auth/administrator', '/api/auth/admin')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
