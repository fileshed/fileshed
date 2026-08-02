//----------------------------------------------------------------------------------------------------------------------
// Legacy View Mode — the one-shot localStorage read-and-clear
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';

// Under test
import { takeLegacyViewMode } from '@client/resource-access/legacyViewMode.ts';

//----------------------------------------------------------------------------------------------------------------------

const VIEW_MODE_KEY = 'fileshed.drive.viewMode';

// Node 26 ships a global localStorage that is non-functional without --localstorage-file, and the jsdom
// environment inherits it — so the spec installs its own working storage instead of trusting the ambient one.
function memoryLocalStorage() : Storage
{
    const store = new Map<string, string>();

    return {
        get length() { return store.size; },
        clear: () => { store.clear(); },
        getItem: (key : string) => store.get(key) ?? null,
        key: (index : number) => [ ...store.keys() ][index] ?? null,
        removeItem: (key : string) => { store.delete(key); },
        setItem: (key : string, value : string) => { store.set(key, String(value)); },
    };
}

describe('takeLegacyViewMode', () =>
{
    beforeEach(() =>
    {
        Object.defineProperty(window, 'localStorage', { value: memoryLocalStorage(), configurable: true });
    });

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
