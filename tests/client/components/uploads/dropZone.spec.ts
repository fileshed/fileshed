//----------------------------------------------------------------------------------------------------------------------
// Drop Zone
//
// A synthetic DragEvent with a populated dataTransfer can't be produced in a real browser (the constructor drops it),
// so the drag-to-upload DOM behaviour is verified here where the event payload is under the test's control: the
// files-only gate, the enter/leave depth counter that keeps the overlay up across child crossings, and the drop emit.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import DropZone from '@client/components/uploads/dropZone.vue';

//----------------------------------------------------------------------------------------------------------------------

const OVERLAY = '.pointer-events-none';

function withFiles(files : File[] = []) : { dataTransfer : { files : File[]; types : string[] } }
{
    return { dataTransfer: { files, types: [ 'Files' ] } };
}

function withoutFiles() : { dataTransfer : { files : File[]; types : string[] } }
{
    return { dataTransfer: { files: [], types: [ 'text/plain' ] } };
}

function mountZone(label = 'My Files') : VueWrapper
{
    return mount(DropZone, {
        props: { label },
        slots: { default: '<p class="surface">content</p>' },
        global: { stubs: { UIcon: true } },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('DropZone', () =>
{
    it('shows no overlay until a file drag enters', () =>
    {
        const wrapper = mountZone();

        expect(wrapper.find(OVERLAY).exists()).toBe(false);
    });

    it('raises an overlay naming the target folder while a file drag is over it', async () =>
    {
        const wrapper = mountZone('Reports');

        await wrapper.trigger('dragenter', withFiles());

        expect(wrapper.find(OVERLAY).exists()).toBe(true);
        expect(wrapper.text()).toContain('Drop files to upload to Reports');
    });

    it('ignores a drag that carries no files', async () =>
    {
        const wrapper = mountZone();

        await wrapper.trigger('dragenter', withoutFiles());

        expect(wrapper.find(OVERLAY).exists()).toBe(false);
    });

    it('keeps the overlay up until the drag has truly left, not merely crossed onto a child', async () =>
    {
        const wrapper = mountZone();

        await wrapper.trigger('dragenter', withFiles());
        await wrapper.trigger('dragenter', withFiles()); // entering a child while still inside
        await wrapper.trigger('dragleave'); // leaving that child
        expect(wrapper.find(OVERLAY).exists()).toBe(true);

        await wrapper.trigger('dragleave'); // leaving the zone
        expect(wrapper.find(OVERLAY).exists()).toBe(false);
    });

    it('emits the dropped files and drops the overlay on drop', async () =>
    {
        const wrapper = mountZone();
        const file = new File([ 'x' ], 'dropped.txt', { type: 'text/plain' });

        await wrapper.trigger('dragenter', withFiles([ file ]));
        await wrapper.trigger('drop', withFiles([ file ]));

        expect(wrapper.emitted('drop-files')).toEqual([ [ [ file ] ] ]);
        expect(wrapper.find(OVERLAY).exists()).toBe(false);
    });

    it('does not emit when a drop carries no files', async () =>
    {
        const wrapper = mountZone();

        await wrapper.trigger('drop', withoutFiles());

        expect(wrapper.emitted('drop-files')).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
