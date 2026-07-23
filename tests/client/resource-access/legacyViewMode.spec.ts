//----------------------------------------------------------------------------------------------------------------------
// Legacy View Mode — the one-shot localStorage read-and-clear
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';

// Under test
import { takeLegacyViewMode } from '@client/resource-access/legacyViewMode.ts';

//----------------------------------------------------------------------------------------------------------------------

const VIEW_MODE_KEY = 'fileshed.drive.viewMode';

describe('takeLegacyViewMode', () =>
{
    beforeEach(() => window.localStorage.clear());

    it('returns a stored grid or list value and clears the key', () =>
    {
        window.localStorage.setItem(VIEW_MODE_KEY, 'list');

        expect(takeLegacyViewMode()).toBe('list');
        expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBeNull();
    });

    it('returns null and still clears the key when the stored value is not a valid view mode', () =>
    {
        window.localStorage.setItem(VIEW_MODE_KEY, 'compact');

        expect(takeLegacyViewMode()).toBeNull();
        expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBeNull();
    });

    it('returns null when there is no stored key', () =>
    {
        expect(takeLegacyViewMode()).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
