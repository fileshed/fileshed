//----------------------------------------------------------------------------------------------------------------------
// PDF Annotation Params Popover
//
// The parameter panel writes each control's change into the real annotator store, the same store the render surface
// forwards to pdf.js. It shows only the current tool's controls, so each test mounts the panel in one mode, drives a
// swatch or slider or toggle, and asserts the store's editor params -- the observable state a real edit would leave.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { AnnotationMode } from '@client/components/handlers/pdf/types.ts';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Under test
import PdfParamsPopover from '@client/components/handlers/pdf/paramsPopover.vue';

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

const USliderStub = {
    name: 'USlider',
    props: [ 'modelValue', 'min', 'max', 'step', 'size' ],
    emits: [ 'update:modelValue' ],
    template: '<input type="range" class="slider" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', Number($event.target.value))" />',
};

const USwitchStub = {
    name: 'USwitch',
    props: [ 'modelValue', 'size' ],
    emits: [ 'update:modelValue' ],
    template: '<input type="checkbox" class="switch" :checked="modelValue" '
        + '@change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

const stubs = {
    USlider: USliderStub,
    USwitch: USwitchStub,
    UIcon: { name: 'UIcon', props: [ 'name' ], template: '<i />' },
};

function mountPopover(mode : AnnotationMode) : VueWrapper
{
    return mount(PdfParamsPopover, { props: { mode }, global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfParamsPopover highlight', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('picks a highlight color from the Mozilla palette', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountPopover('highlight');

        await wrapper.get('[aria-label="Green"]').trigger('click');

        expect(store.editorParams.highlight.color).toBe('#53FFBC');
    });

    it('sets the highlight thickness from the slider', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountPopover('highlight');

        await wrapper.get('.slider').setValue('20');

        expect(store.editorParams.highlight.thickness).toBe(20);
    });

    it('toggles show-all from the switch', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountPopover('highlight');

        await wrapper.get('.switch').setValue(false);

        expect(store.editorParams.highlight.showAll).toBe(false);
    });
});

describe('PdfParamsPopover text', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('picks a text color and sets the font size', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountPopover('freetext');

        await wrapper.get('[aria-label="Blue"]').trigger('click');
        await wrapper.get('.slider').setValue('28');

        expect(store.editorParams.text.color).toBe('#2E7CF6');
        expect(store.editorParams.text.size).toBe(28);
    });
});

describe('PdfParamsPopover ink', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('picks an ink color and sets thickness and opacity', async () =>
    {
        const store = usePdfAnnotatorStore();
        const wrapper = mountPopover('ink');

        await wrapper.get('[aria-label="Red"]').trigger('click');
        const sliders = wrapper.findAll('.slider');
        await sliders[0]?.setValue('10');
        await sliders[1]?.setValue('40');

        expect(store.editorParams.ink.color).toBe('#E4463F');
        expect(store.editorParams.ink.thickness).toBe(10);
        expect(store.editorParams.ink.opacity).toBe(40);
    });
});

//----------------------------------------------------------------------------------------------------------------------
