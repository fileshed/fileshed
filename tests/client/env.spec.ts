//----------------------------------------------------------------------------------------------------------------------
// Dev Env Loading — apply semantics
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Utils
import { applyEnvDefaults } from '../../src/client/env.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('applyEnvDefaults', () =>
{
    it('fills keys the target does not have', () =>
    {
        const target : Record<string, string | undefined> = { PRESENT: 'kept' };

        applyEnvDefaults({ ADDED: 'from-env-file' }, target);

        expect(target.ADDED).toBe('from-env-file');
        expect(target.PRESENT).toBe('kept');
    });

    it('never overwrites an existing value — the real environment wins', () =>
    {
        const target : Record<string, string | undefined> = { PORT: '9999' };

        applyEnvDefaults({ PORT: '3000' }, target);

        expect(target.PORT).toBe('9999');
    });
});

//----------------------------------------------------------------------------------------------------------------------
