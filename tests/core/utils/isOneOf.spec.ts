//----------------------------------------------------------------------------------------------------------------------
// isOneOf
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import { isOneOf } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const colors = [ 'red', 'green' ] as const;

describe('isOneOf', () =>
{
    it('admits a member of the vocabulary', () =>
    {
        expect(isOneOf(colors, 'green')).toBe(true);
    });

    it('refuses a value outside it, matching case exactly', () =>
    {
        expect(isOneOf(colors, 'blue')).toBe(false);
        expect(isOneOf(colors, 'Red')).toBe(false);
    });

    it('refuses an absent value', () =>
    {
        expect(isOneOf(colors, null)).toBe(false);
        expect(isOneOf(colors, undefined)).toBe(false);
    });

    it('compares numbers by value without coercing strings', () =>
    {
        const statuses = [ 400, 404 ] as const;

        expect(isOneOf(statuses, 404)).toBe(true);
        expect(isOneOf(statuses, '404')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
