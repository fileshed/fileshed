//----------------------------------------------------------------------------------------------------------------------
// Format Regulation Code
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { RegulationViolation } from '@fileshed/core';

import { RegulationApiError } from '@client/resource-access/apiError.ts';
import { regulationMessage } from '@client/utils/formatters/formatRegulationCode.ts';

//----------------------------------------------------------------------------------------------------------------------

function rejection(violations : RegulationViolation[], message = 'Blocked by a rule.') : RegulationApiError
{
    return new RegulationApiError(422, message, violations);
}

//----------------------------------------------------------------------------------------------------------------------

describe('regulationMessage', () =>
{
    it('renders friendly copy for a known regulation code instead of the raw message', () =>
    {
        const error = rejection([ { code: 'move.intoDescendant', message: 'raw server text' } ]);

        expect(regulationMessage(error)).toBe('You can\'t move a folder into one of its own subfolders.');
    });

    it('uses the first code that has copy when several violations arrive', () =>
    {
        const error = rejection([
            { code: 'move.intoSelf', message: 'raw server text' },
            { code: 'quota.exceeded', message: 'raw server text' },
        ]);

        expect(regulationMessage(error)).toBe('You can\'t move a folder into itself.');
    });

    it('falls back to the server message when the rejection carries no violations', () =>
    {
        const error = rejection([], 'Server said no.');

        expect(regulationMessage(error)).toBe('Server said no.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
