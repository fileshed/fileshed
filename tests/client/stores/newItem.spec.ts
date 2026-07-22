//----------------------------------------------------------------------------------------------------------------------
// New Item Store
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useNewItemStore } from '@client/stores/newItem.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('useNewItemStore', () =>
{
    beforeEach(() => setActivePinia(createPinia()));

    it('starts with no pending request', () =>
    {
        const store = useNewItemStore();

        expect(store.request).toBeNull();
    });

    it('records the requested kind', () =>
    {
        const store = useNewItemStore();

        store.requestNew('markdown');

        expect(store.request?.kind).toBe('markdown');
    });

    it('gives the same kind a fresh nonce each time, so a repeat is a distinct request', () =>
    {
        const store = useNewItemStore();

        store.requestNew('folder');
        const first = store.request?.nonce;
        store.requestNew('folder');
        const second = store.request?.nonce;

        expect(first).toBeDefined();
        expect(second).toBeDefined();
        expect(second).not.toBe(first);
    });

    it('clears the request on consume', () =>
    {
        const store = useNewItemStore();
        store.requestNew('text');

        store.consume();

        expect(store.request).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
