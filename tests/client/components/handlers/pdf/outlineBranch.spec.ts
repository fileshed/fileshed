//----------------------------------------------------------------------------------------------------------------------
// PDF Outline Branch
//
// One outline row over the real annotator store: a row with a destination navigates, a heading without one does not,
// and nesting renders through the same component. Navigation is observed through the registered document access, which
// stands in for the renderer.
//----------------------------------------------------------------------------------------------------------------------

import { type VueWrapper, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Components
import type { OutlineDestination, OutlineEntry } from '@client/components/handlers/pdf/types.ts';

// Under test
import PdfOutlineBranch from '@client/components/handlers/pdf/sidebar/outlineBranch.vue';

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
        props: [ 'icon', 'variant', 'color', 'size', 'ariaLabel' ],
        emits: [ 'click' ],
        template: '<button :aria-label="ariaLabel" @click="$emit(\'click\')" />',
    },
};

interface BranchInit
{
    id ?: string;
    title ?: string;
    dest ?: OutlineDestination | null;
    items ?: OutlineEntry[];
}

function entry(init : BranchInit = {}) : OutlineEntry
{
    return {
        id: init.id ?? '0',
        title: init.title ?? 'Chapter one',
        bold: false,
        italic: false,
        dest: init.dest === undefined ? 'ch1' : init.dest,
        items: init.items ?? [],
    };
}

function mountBranch(init : BranchInit = {}) : VueWrapper
{
    return mount(PdfOutlineBranch, { props: { entry: entry(init) }, global: { stubs } });
}

// Stands in for the live renderer so a navigation can be observed without one.
function registerAccess() : { goToDestination : ReturnType<typeof vi.fn> }
{
    const access = {
        save: vi.fn(() => Promise.resolve(new Uint8Array())),
        serialize: vi.fn(() => Promise.resolve(new Uint8Array())),
        renderThumbnail: vi.fn(() => Promise.resolve()),
        readAttachment: vi.fn(() => Promise.resolve(null)),
        goToDestination: vi.fn(),
        addImage: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
    };

    usePdfAnnotatorStore().setDocumentAccess(access);

    return access;
}

//----------------------------------------------------------------------------------------------------------------------

describe('PdfOutlineBranch', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('sends the reader to the entry\'s destination', async () =>
    {
        const access = registerAccess();
        const wrapper = mountBranch({ title: 'Chapter one', dest: 'ch1' });

        await wrapper.get('button').trigger('click');

        expect(access.goToDestination).toHaveBeenCalledWith('ch1');
    });

    it('refuses to navigate from a heading that points nowhere', async () =>
    {
        const access = registerAccess();
        const wrapper = mountBranch({ dest: null });

        expect(wrapper.get('button').attributes('disabled')).toBeDefined();

        await wrapper.get('button').trigger('click');

        expect(access.goToDestination).not.toHaveBeenCalled();
    });

    it('labels an entry whose title is blank, so the row is still reachable', () =>
    {
        const wrapper = mountBranch({ title: '' });

        expect(wrapper.text()).toContain('Untitled');
    });

    it('renders its children through itself', () =>
    {
        const wrapper = mountBranch({
            title: 'Part one',
            items: [ entry({ id: '0.0', title: 'Chapter two' }) ],
        });

        expect(wrapper.text()).toContain('Chapter two');
    });

    it('arrives collapsed below the first level, so a deep outline is not a wall of text', () =>
    {
        const wrapper = mountBranch({
            id: '0.1',
            title: 'Chapter three',
            items: [ entry({ id: '0.1.0', title: 'Section one' }) ],
        });

        expect(wrapper.text()).not.toContain('Section one');
    });
});

//----------------------------------------------------------------------------------------------------------------------
