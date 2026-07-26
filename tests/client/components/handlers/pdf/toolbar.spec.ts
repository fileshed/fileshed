//----------------------------------------------------------------------------------------------------------------------
// PDF Annotator Toolbar
//
// The toolbar drives the real annotator store: the zoom steppers walk the scale, the page box commits a clamped jump,
// the overflow menu rotates and paginates, print opens the file's inline URL in a new tab, and the find button reveals
// the find bar. Only the store's resource-access and toast seams are mocked; each test asserts the store state (or the
// window it opened) a real click would produce, not that a handler was wired.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse } from '@fileshed/core';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Under test
import PdfToolbar from '@client/components/handlers/pdf/toolbar.vue';

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
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'ariaLabel', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button :aria-label="ariaLabel" :data-icon="icon" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue', 'ui', 'size', 'ariaLabel' ],
    emits: [ 'update:modelValue' ],
    template: '<input :aria-label="ariaLabel" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UDropdownMenuStub = {
    name: 'UDropdownMenu',
    props: [ 'items' ],
    computed: { flat() { return (this.items as unknown[][]).flat(); } },
    template: '<div><slot /><button v-for="item in flat" :key="item.label" :data-menuitem="item.label" '
        + '@click="item.onSelect && item.onSelect($event)">{{ item.label }}</button></div>',
};

const stubs = {
    UButton: UButtonStub,
    UInput: UInputStub,
    UDropdownMenu: UDropdownMenuStub,
    USelectMenu: { name: 'USelectMenu', props: [ 'modelValue', 'items' ], template: '<select />' },
    UFieldGroup: { template: '<div><slot /></div>' },
    UPopover: { template: '<div><slot /></div>' },
    UBadge: { template: '<span><slot /></span>', props: [ 'label', 'icon', 'color', 'variant' ] },
    UIcon: { template: '<i />', props: [ 'name' ] },
    PdfFindBar: { name: 'PdfFindBar', template: '<div class="find-bar" />' },
    PdfParamsPopover: { name: 'PdfParamsPopover', props: [ 'mode' ], template: '<div />' },
};

function fileNode(overrides : Partial<NodeResponse> = {}) : NodeResponse
{
    return {
        id: 'f1',
        name: 'contract.pdf',
        ownerID: 'u1',
        parentID: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 2048,
        mimeType: 'application/pdf',
        trashedAt: null,
        ...overrides,
    };
}

function mountToolbar() : VueWrapper
{
    return mount(PdfToolbar, { global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfToolbar zoom', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('steps zoom out one rung', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setZoom('1');
        const wrapper = mountToolbar();

        await wrapper.get('[aria-label="Zoom out"]').trigger('click');

        expect(store.zoom).toBe('0.75');
    });

    it('steps zoom in one rung', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setZoom('1');
        const wrapper = mountToolbar();

        await wrapper.get('[aria-label="Zoom in"]').trigger('click');

        expect(store.zoom).toBe('1.25');
    });
});

describe('PdfToolbar page box', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('commits a typed page jump', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(3, 10);
        const wrapper = mountToolbar();

        const box = wrapper.get('input[aria-label="Page number"]');
        await box.setValue('7');
        await box.trigger('keydown', { key: 'Enter' });

        expect(store.currentPage).toBe(7);
    });

    it('clamps a typed jump past the last page', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(3, 10);
        const wrapper = mountToolbar();

        const box = wrapper.get('input[aria-label="Page number"]');
        await box.setValue('99');
        await box.trigger('keydown', { key: 'Enter' });

        expect(store.currentPage).toBe(10);
    });
});

describe('PdfToolbar overflow menu', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('rotates the pages clockwise and counter-clockwise', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountToolbar();

        await wrapper.get('[data-menuitem="Rotate right"]').trigger('click');
        expect(store.rotation).toBe(90);

        await wrapper.get('[data-menuitem="Rotate left"]').trigger('click');
        expect(store.rotation).toBe(0);
    });

    it('jumps to the first and last pages', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setPage(5, 10);
        const wrapper = mountToolbar();

        await wrapper.get('[data-menuitem="First page"]').trigger('click');
        expect(store.currentPage).toBe(1);

        await wrapper.get('[data-menuitem="Last page"]').trigger('click');
        expect(store.currentPage).toBe(10);
    });

    it('prints by opening the file\'s inline URL in a new tab', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.node = fileNode({ id: 'f1' });
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null) as unknown as Mock;
        const wrapper = mountToolbar();

        await wrapper.get('[data-menuitem="Print (opens in new tab)"]').trigger('click');

        expect(openSpy).toHaveBeenCalledWith('/api/nodes/f1/download?disposition=inline', '_blank', 'noopener');
    });
});

describe('PdfToolbar find', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('reveals the find bar when the find button is pressed', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountToolbar();

        await wrapper.get('[aria-label="Find in document"]').trigger('click');

        expect(store.findOpen).toBe(true);
        expect(wrapper.find('.find-bar').exists()).toBe(true);
    });
});

// Identity -- the file name, save state, and Save -- moved to the layout header (the PDF identity bar), so the toolbar
// row is now pure viewing/annotation controls.
describe('PdfToolbar slimmed row', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('carries no Save button or file name -- those live in the header', () =>
    {
        const store = usePdfAnnotatorStore();
        store.node = fileNode({ name: 'contract.pdf' });
        const wrapper = mountToolbar();

        expect(wrapper.find('[data-icon="i-lucide-save"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('contract.pdf');
    });

    it('keeps the find, zoom, and overflow controls', () =>
    {
        const wrapper = mountToolbar();

        expect(wrapper.find('[aria-label="Find in document"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Zoom in"]').exists()).toBe(true);
        expect(wrapper.find('[aria-label="More actions"]').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
