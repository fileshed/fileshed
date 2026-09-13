//----------------------------------------------------------------------------------------------------------------------
// PDF Page Controls
//
// The page controls drive the real annotator store: the steppers move one page and stop at each end, and the box
// commits a clamped jump and snaps back to whatever the store accepted. Only the store's resource-access and toast
// boundaries are mocked, so each test asserts the store state a real click would leave.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Under test
import PdfPageControls from '@client/components/handlers/pdf/pageControls.vue';

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

const stubs = {
    UButton: {
        name: 'UButton',
        props: [ 'icon', 'variant', 'color', 'size', 'ariaLabel', 'disabled' ],
        emits: [ 'click' ],
        template: '<button :aria-label="ariaLabel" :disabled="disabled" @click="$emit(\'click\')" />',
    },
    UInput: {
        name: 'UInput',
        props: [ 'modelValue', 'ui', 'size', 'ariaLabel', 'inputmode' ],
        emits: [ 'update:modelValue' ],
        template: '<input :aria-label="ariaLabel" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
};

function mountControls() : VueWrapper
{
    return mount(PdfPageControls, { global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfPageControls', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('shows nothing until a document reports how many pages it has', () =>
    {
        const wrapper = mountControls();

        expect(wrapper.find('[aria-label="Page number"]').exists()).toBe(false);
    });

    it('steps one page forward', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(3, 10);
        const wrapper = mountControls();

        await wrapper.get('[aria-label="Next page"]').trigger('click');

        expect(store.currentPage).toBe(4);
    });

    it('disables the back stepper on the first page', () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(1, 10);
        const wrapper = mountControls();

        expect(wrapper.get('[aria-label="Previous page"]').attributes('disabled')).toBeDefined();
    });

    it('disables the forward stepper on the last page', () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(10, 10);
        const wrapper = mountControls();

        expect(wrapper.get('[aria-label="Next page"]').attributes('disabled')).toBeDefined();
    });

    it('clamps a typed page past the end down to the last one', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(1, 10);
        const wrapper = mountControls();

        const box = wrapper.get('[aria-label="Page number"]');
        await box.setValue('99');
        await box.trigger('keydown.enter');

        expect(store.currentPage).toBe(10);
        expect((box.element as HTMLInputElement).value).toBe('10');
    });

    it('leaves the page alone when the box is committed with nothing parseable in it', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(4, 10);
        const wrapper = mountControls();

        const box = wrapper.get('[aria-label="Page number"]');
        await box.setValue('later');
        await box.trigger('blur');

        expect(store.currentPage).toBe(4);
        expect((box.element as HTMLInputElement).value).toBe('4');
    });
});

//----------------------------------------------------------------------------------------------------------------------
