//----------------------------------------------------------------------------------------------------------------------
// PDF Find Bar
//
// The find strip drives the real annotator store: typing searches as you go, the walkers repeat the search forward and
// back, the case button re-runs with the new sensitivity, close tears the search down, and the tally reflects what the
// renderer reported. Only the store's resource-access and toast seams are mocked -- the store's own find logic runs, so
// each test asserts the store state a real search would leave, not that a handler fired.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Under test
import PdfFindBar from '@client/components/handlers/pdf/findBar.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(), uploadTicket: vi.fn(), answerChallenge: vi.fn(),
}));
vi.mock('@client/engines/claim.ts', () => ({ computeProofAnswer: vi.fn() }));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'variant', 'color', 'size', 'ariaLabel' ],
    emits: [ 'click' ],
    template: '<button :aria-label="ariaLabel" :data-icon="icon" :data-variant="variant" '
        + '@click="$emit(\'click\')" />',
};

const stubs = {
    UButton: UButtonStub,
    UIcon: { name: 'UIcon', props: [ 'name' ], template: '<i />' },
};

function mountBar() : VueWrapper
{
    return mount(PdfFindBar, { global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfFindBar', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('searches for the typed query as it is entered', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountBar();

        await wrapper.find('input').setValue('invoice');

        expect(store.findQuery).toBe('invoice');
        expect(store.findRequest).toMatchObject({ query: 'invoice', again: false });
    });

    it('walks to the next and previous matches', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setFindQuery('invoice');
        const wrapper = mountBar();

        await wrapper.get('[aria-label="Next match"]').trigger('click');
        expect(store.findRequest).toMatchObject({ again: true, findPrevious: false });

        await wrapper.get('[aria-label="Previous match"]').trigger('click');
        expect(store.findRequest).toMatchObject({ again: true, findPrevious: true });
    });

    it('toggles case sensitivity', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setFindQuery('invoice');
        const wrapper = mountBar();

        await wrapper.get('[aria-label="Match case"]').trigger('click');

        expect(store.findCaseSensitive).toBe(true);
    });

    it('closes the find bar', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.openFind();
        const wrapper = mountBar();

        await wrapper.get('[aria-label="Close find"]').trigger('click');

        expect(store.findOpen).toBe(false);
    });

    it('shows the match tally when there are results', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setFindQuery('invoice');
        store.setFindResult(2, 5);
        const wrapper = mountBar();

        expect(wrapper.text()).toContain('2 of 5');
    });

    it('reads "No results" for a query that matches nothing', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setFindQuery('invoice');
        store.setFindResult(0, 0);
        const wrapper = mountBar();

        expect(wrapper.text()).toContain('No results');
    });
});

//----------------------------------------------------------------------------------------------------------------------
