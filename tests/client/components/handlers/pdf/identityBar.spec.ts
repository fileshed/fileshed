//----------------------------------------------------------------------------------------------------------------------
// PDF Identity Bar — the header contribution
//
// The PDF annotator's header chrome: the file name, a save-state readout, and Save (a Read only badge in its place for
// a viewer). It teleports into the layout header, so the real annotator store runs and the assertions read the
// teleported content out of the target. What this guards: the name teleports into the target when present, Save drives
// a store save only over a dirty writable session and is disabled when clean, and a viewer sees a Read only badge.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { usePDFAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Support
import { fileNode } from '../../../support.ts';

// Under test
import PDFIdentityBar from '@client/components/handlers/pdf/identityBar.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getNode: vi.fn(), getNodeSharing: vi.fn(async () => ({ granteeCount: 0, linkURL: null })),
}));
vi.mock('@client/resource-access/content.ts', () => ({ getNodeBlob: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const HEADER_ID = 'editor-header-center';

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || loading" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const stubs = {
    UButton: UButtonStub,
    DownloadAction: { props: [ 'nodeID' ], template: '<a class="download" :data-node="nodeID" />' },
    UBadge: {
        name: 'UBadge',
        props: [ 'label', 'icon', 'color', 'variant' ],
        template: '<span class="badge" :data-label="label" />',
    },
    UIcon: { props: [ 'name' ], template: '<i />' },
};

function makeTarget() : void
{
    const el = document.createElement('div');
    el.id = HEADER_ID;
    document.body.appendChild(el);
}

function header() : HTMLElement
{
    const el = document.getElementById(HEADER_ID);
    if(el === null) { throw new Error('header target missing'); }

    return el;
}

async function mountBar(options : { role ?: Role; dirty ?: boolean } = {}) : Promise<VueWrapper>
{
    const store = usePDFAnnotatorStore();
    store.$patch({ node: fileNode({ name: 'contract.pdf', role: options.role ?? 'owner' }) });
    store.setDirty(options.dirty ?? false);

    const wrapper = mount(PDFIdentityBar, { global: { stubs } });
    await nextTick();

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

describe('PDFIdentityBar', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        setActivePinia(createPinia());
        makeTarget();
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    it('teleports the file name into the header target', async () =>
    {
        await mountBar();

        expect(header().textContent).toContain('contract.pdf');
    });

    it('drives a store save when Save is clicked over a dirty writable session', async () =>
    {
        const store = usePDFAnnotatorStore();
        const saveSpy = vi.spyOn(store, 'save').mockResolvedValue();
        await mountBar({ dirty: true });

        header().querySelector<HTMLButtonElement>('[data-label="Save"]')
            ?.click();

        expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('disables Save when there are no unsaved marks', async () =>
    {
        await mountBar({ dirty: false });

        expect(header().querySelector('[data-label="Save"]')
            ?.hasAttribute('disabled')).toBe(true);
    });

    it('shows a Read only badge and no Save button for a viewer', async () =>
    {
        await mountBar({ role: 'viewer', dirty: true });

        expect(header().querySelector('.badge')
            ?.getAttribute('data-label')).toBe('Read only');
        expect(header().querySelector('[data-label="Save"]')).toBeNull();
    });

    it('offers a download of the open file', async () =>
    {
        await mountBar();

        expect(header().querySelector('.download')
            ?.getAttribute('data-node')).toBe('f1');
    });
});

//----------------------------------------------------------------------------------------------------------------------
