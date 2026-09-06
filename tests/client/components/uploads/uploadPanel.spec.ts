//----------------------------------------------------------------------------------------------------------------------
// Upload Panel — what the header and the skip note say
//
// The queue's own behaviour is the store's; this is the sentence the user reads over it. The skipped count is the
// only report a filtered file gets -- it takes no row, so if the panel does not say it, nothing does.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { useUploadsStore } from '@client/stores/uploads.ts';

// Under test
import UploadPanel from '@client/components/uploads/uploadPanel.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

interface PanelState
{
    skipped ?: number;
    done ?: number;
}

function mountPanel(state : PanelState = {}) : VueWrapper
{
    setActivePinia(createPinia());

    const store = useUploadsStore();
    store.skipped = state.skipped ?? 0;

    for(let index = 0; index < (state.done ?? 0); index += 1)
    {
        store.items.push({
            id: `upload-${ index }`,
            file: new File([ new Uint8Array(3) ], `report-${ index }.txt`, { type: 'text/plain' }),
            folderID: null,
            name: `report-${ index }.txt`,
            status: 'done',
            error: null,
            result: null,
            progress: { hashedBytes: 3, sentBytes: 3, totalBytes: 3 },
        });
    }

    return mount(UploadPanel, { global: { stubs: { UButton: true, UploadRow: true } } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('UploadPanel', () =>
{
    it('stays out of the way when there is nothing to report', () =>
    {
        expect(mountPanel().text()).toBe('');
    });

    it('says nothing about skipping when nothing was skipped', () =>
    {
        expect(mountPanel({ done: 1 }).text()).not.toContain('Skipped');
    });

    it('reports what it skipped alongside the files it uploaded', () =>
    {
        expect(mountPanel({ done: 1, skipped: 3 }).text())
            .toContain('Skipped 3 files this instance does not store.');
    });

    it('counts one skipped file in the singular', () =>
    {
        expect(mountPanel({ done: 1, skipped: 1 }).text())
            .toContain('Skipped 1 file this instance does not store.');
    });

    // Dragging a folder that holds nothing but junk leaves no rows at all, and silence would read as the drop having
    // been ignored.
    it('reports a batch that was entirely skipped, with no rows under it', () =>
    {
        const panel = mountPanel({ skipped: 2 });

        expect(panel.text()).toContain('2 files skipped');
        expect(panel.text()).toContain('Skipped 2 files this instance does not store.');
        expect(panel.findAll('upload-row-stub')).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
