//----------------------------------------------------------------------------------------------------------------------
// PDF Attachment List
//
// Embedded files over the real annotator store: the list names what the document carries, and saving one writes the
// bytes the renderer holds. The downloads module is mocked, since writing a file is the observable outcome here.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { saveBytes } from '@client/resource-access/downloads.ts';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Components
import type { DocumentProperties } from '@client/components/handlers/pdf/types.ts';

// Under test
import PdfAttachmentList from '@client/components/handlers/pdf/sidebar/attachmentList.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(), uploadTicket: vi.fn(), answerChallenge: vi.fn(),
}));
vi.mock('@client/resource-access/downloads.ts', () => ({
    downloadUrl: vi.fn(() => '/api/nodes/f1/download'),
    saveBytes: vi.fn(),
    showBytesIn: vi.fn(),
}));
vi.mock('@client/engines/claim.ts', () => ({ computeProofAnswer: vi.fn() }));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const saveBytesMock = saveBytes as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    UButton: {
        name: 'UButton',
        props: [ 'icon', 'variant', 'color', 'size', 'ariaLabel' ],
        emits: [ 'click' ],
        template: '<button :aria-label="ariaLabel" @click="$emit(\'click\')" />',
    },
    UIcon: { name: 'UIcon', props: [ 'name' ], template: '<i />' },
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
        pageCount: 1,
        pageSize: 'A4',
        linearized: false,
    };
}

function mountList() : VueWrapper
{
    return mount(PdfAttachmentList, { global: { stubs } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfAttachmentList', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('says so when the document carries no embedded files', () =>
    {
        const wrapper = mountList();

        expect(wrapper.text()).toContain('no attachments');
    });

    it('names each embedded file and what the document says about it', () =>
    {
        const store = usePdfAnnotatorStore();
        store.setDocumentFacts({
            outline: [],
            attachments: [ { id: 'a0', filename: 'appendix.csv', description: 'Quarterly figures' } ],
            properties: documentProperties(),
        });
        const wrapper = mountList();

        expect(wrapper.text()).toContain('appendix.csv');
        expect(wrapper.text()).toContain('Quarterly figures');
    });

    it('writes the bytes the renderer holds when one is saved', async () =>
    {
        const content = new Uint8Array([ 1, 2, 3 ]);
        const store = usePdfAnnotatorStore();
        store.setDocumentAccess({
            save: vi.fn(() => Promise.resolve(new Uint8Array())),
            serialize: vi.fn(() => Promise.resolve(new Uint8Array())),
            renderThumbnail: vi.fn(() => Promise.resolve()),
            readAttachment: vi.fn(() => Promise.resolve(content)),
            goToDestination: vi.fn(),
            addImage: vi.fn(),
            undo: vi.fn(),
            redo: vi.fn(),
        });
        store.setDocumentFacts({
            outline: [],
            attachments: [ { id: 'a0', filename: 'appendix.csv', description: '' } ],
            properties: documentProperties(),
        });
        const wrapper = mountList();

        await wrapper.get('[aria-label="Save appendix.csv"]').trigger('click');

        expect(saveBytesMock).toHaveBeenCalledWith(content, 'appendix.csv', 'application/octet-stream');
    });
});

//----------------------------------------------------------------------------------------------------------------------
