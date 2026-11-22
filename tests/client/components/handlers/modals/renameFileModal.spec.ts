//----------------------------------------------------------------------------------------------------------------------
// Rename File Modal — renaming the open file from the editor header
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

// Under test
import RenameFileModal from '@client/components/handlers/modals/renameFileModal.vue';

//----------------------------------------------------------------------------------------------------------------------

const toastAdd = vi.hoisted(() => vi.fn());

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

//----------------------------------------------------------------------------------------------------------------------

interface Openable { open : () => void }

const NameDialogStub = {
    name: 'NameDialog',
    props: { open: Boolean, title: String, initial: String, pending: Boolean, excludeExtension: Boolean },
    emits: [ 'submit', 'update:open' ],
    template: '<div class="name-dialog" :data-open="String(open)" :data-initial="initial" '
        + ':data-exclude-extension="String(excludeExtension)" />',
};

async function openModal(rename : (name : string) => Promise<void>) : Promise<VueWrapper>
{
    const wrapper = mount(RenameFileModal, {
        props: { name: 'notes.md', rename },
        global: { stubs: { NameDialog: NameDialogStub } },
    });

    (wrapper.vm as unknown as Openable).open();
    await flushPromises();

    return wrapper;
}

function field(wrapper : VueWrapper, name : string) : string | undefined
{
    return wrapper.find('.name-dialog').attributes(name);
}

async function submit(wrapper : VueWrapper, name : string) : Promise<void>
{
    wrapper.findComponent({ name: 'NameDialog' }).vm.$emit('submit', name);

    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('RenameFileModal', () =>
{
    beforeEach(() => { vi.clearAllMocks(); });

    it('opens prefilled with the file\'s current name, selected up to its extension', async () =>
    {
        const wrapper = await openModal(vi.fn());

        expect(field(wrapper, 'data-open')).toBe('true');
        expect(field(wrapper, 'data-initial')).toBe('notes.md');
        expect(field(wrapper, 'data-exclude-extension')).toBe('true');
    });

    it('renames the file to the entered name, then closes', async () =>
    {
        const rename = vi.fn<(name : string) => Promise<void>>().mockResolvedValue(undefined);
        const wrapper = await openModal(rename);

        await submit(wrapper, 'renamed.md');

        expect(rename).toHaveBeenCalledWith('renamed.md');
        expect(field(wrapper, 'data-open')).toBe('false');
    });

    it('closes without renaming when the name is unchanged', async () =>
    {
        const rename = vi.fn<(name : string) => Promise<void>>().mockResolvedValue(undefined);
        const wrapper = await openModal(rename);

        await submit(wrapper, 'notes.md');

        expect(rename).not.toHaveBeenCalled();
        expect(field(wrapper, 'data-open')).toBe('false');
    });

    it('stays open and toasts when the rename fails', async () =>
    {
        const wrapper = await openModal(vi.fn(async () => { throw new Error('boom'); }));

        await submit(wrapper, 'renamed.md');

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        expect(field(wrapper, 'data-open')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
