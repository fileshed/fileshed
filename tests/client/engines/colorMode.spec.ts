//----------------------------------------------------------------------------------------------------------------------
// Color Mode Engine — who wins
//
// The resolution contract: a forced instance mode beats the user's choice (that is what forcing means), the
// user's choice beats the instance default, the instance default stands with no choice, and no branding facts
// at all resolve to following the system.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { resolveColorMode, resolvesToDark } from '@client/engines/colorMode.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('resolveColorMode', () =>
{
    it('lets a forced instance mode beat the user\'s own choice', () =>
    {
        expect(resolveColorMode({ mode: 'dark', forcedMode: true }, 'light')).toBe('dark');
        expect(resolveColorMode({ mode: 'light', forcedMode: true }, undefined)).toBe('light');
    });

    it('lets the user\'s choice beat the instance default when nothing is forced', () =>
    {
        expect(resolveColorMode({ mode: 'dark', forcedMode: false }, 'light')).toBe('light');
        expect(resolveColorMode({ mode: 'system', forcedMode: false }, 'dark')).toBe('dark');
    });

    it('answers the instance default when the user never chose', () =>
    {
        expect(resolveColorMode({ mode: 'dark', forcedMode: false }, undefined)).toBe('dark');
    });

    it('follows the system while the branding facts have not arrived', () =>
    {
        expect(resolveColorMode(null, 'dark')).toBe('system');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('resolvesToDark', () =>
{
    it('paints dark for dark, light for light, and follows the OS signal for system', () =>
    {
        expect(resolvesToDark('dark', false)).toBe(true);
        expect(resolvesToDark('light', true)).toBe(false);
        expect(resolvesToDark('system', true)).toBe(true);
        expect(resolvesToDark('system', false)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
