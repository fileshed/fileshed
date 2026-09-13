//----------------------------------------------------------------------------------------------------------------------
// PDF Sidebar
//
// The rail's tabs over the real annotator store: a tab whose document carries nothing is offered but not pressable,
// and choosing one switches the pane. Only the store's resource-access and toast boundaries are mocked.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Components
import type { DocumentProperties } from '@client/components/handlers/pdf/types.ts';

// Under test
import PdfSidebar from '@client/components/handlers/pdf/sidebar/sidebar.vue';

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
        template: '<button :aria-label="ariaLabel" :data-variant="variant" :disabled="disabled" '
            + '@click="$emit(\'click\')" />',
    },
    PdfThumbnailRail: { name: 'PdfThumbnailRail', template: '<div class="thumbnails" />' },
    PdfOutlineTree: { name: 'PdfOutlineTree', template: '<div class="outline" />' },
    PdfAttachmentList: { name: 'PdfAttachmentList', template: '<div class="attachments" />' },
};

function documentProperties() : DocumentProperties
{
    return {
        title: null,
        author: null,
        subject: null,
        keywords: null,
        creator: null,
        producer: null,
        creationDate: null,
        modificationDate: null,
        version: '1.7',
        pageCount: 2,
        pageSize: 'Letter',
        linearized: false,
    };
}

function mountSidebar() : VueWrapper
{
    return mount(PdfSidebar, { global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfSidebar', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('opens on thumbnails, which every document has', () =>
    {
        const wrapper = mountSidebar();

        expect(wrapper.find('.thumbnails').exists()).toBe(true);
    });

    it('offers the outline tab unpressable when the document has no outline', () =>
    {
        const store = usePdfAnnotatorStore();
        store.setDocumentFacts({ outline: [], attachments: [], properties: documentProperties() });
        const wrapper = mountSidebar();

        expect(wrapper.get('[aria-label="Document outline"]').attributes('disabled')).toBeDefined();
    });

    it('switches to the outline pane when the document has one', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setDocumentFacts({
            outline: [ { id: '0', title: 'Chapter one', bold: false, italic: false, dest: 'ch1', items: [] } ],
            attachments: [],
            properties: documentProperties(),
        });
        const wrapper = mountSidebar();

        await wrapper.get('[aria-label="Document outline"]').trigger('click');

        expect(store.sidebarTab).toBe('outline');
        expect(wrapper.find('.outline').exists()).toBe(true);
    });

    it('switches to the attachments pane when the document carries embedded files', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.setDocumentFacts({
            outline: [],
            attachments: [ { id: 'a0', filename: 'appendix.csv', description: '' } ],
            properties: documentProperties(),
        });
        const wrapper = mountSidebar();

        await wrapper.get('[aria-label="Attachments"]').trigger('click');

        expect(wrapper.find('.attachments').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
