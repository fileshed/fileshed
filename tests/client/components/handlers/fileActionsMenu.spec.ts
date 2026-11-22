//----------------------------------------------------------------------------------------------------------------------
// File Actions Menu — the editor header's menu beside the file name
//
// The contract: an editor gets Rename file, the handler's own entries, then Download, in that order; a viewer loses
// Rename but keeps Download, since reading a file is enough to take a copy of it; Download is a plain link to the
// file's download endpoint; Rename file opens the rename modal; and closing the menu leaves focus in a dialog an entry
// opened rather than pulling it back to the trigger.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';

// Under test
import FileActionsMenu from '@client/components/handlers/fileActionsMenu.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const openRename = vi.fn();

const stubs = {
    UDropdownMenu: {
        name: 'UDropdownMenu',
        props: [ 'items', 'content' ],
        template: '<div><template v-for="item in items" :key="item.label">'
            + '<a v-if="item.to" class="item" :href="item.to" :data-external="String(item.external)">'
            + '{{ item.label }}</a>'
            + '<button v-else class="item" @click="item.onSelect()">{{ item.label }}</button>'
            + '</template><slot /></div>',
    },
    UButton: { template: '<button class="trigger" />' },
    RenameFileModal: defineComponent({
        setup(_, { expose })
        {
            expose({ open: openRename });
            return () => h('div');
        },
    }),
};

function mountMenu(options : { readOnly ?: boolean; items ?: DropdownMenuItem[] } = {}) : VueWrapper
{
    return mount(FileActionsMenu, {
        props: {
            nodeID: 'f1',
            name: 'notes.md',
            readOnly: options.readOnly ?? false,
            rename: vi.fn(),
            items: options.items,
        },
        global: { stubs },
    });
}

function labels(wrapper : VueWrapper) : string[]
{
    return wrapper.findAll('.item').map((item) => item.text());
}

//----------------------------------------------------------------------------------------------------------------------

describe('FileActionsMenu', () =>
{
    it('lists Rename file, then the handler\'s entries, then Download', () =>
    {
        const wrapper = mountMenu({ items: [ { label: 'Edit properties' } ] });

        expect(labels(wrapper)).toEqual([ 'Rename file', 'Edit properties', 'Download' ]);
    });

    it('leaves Rename out for a viewer but keeps Download', () =>
    {
        const wrapper = mountMenu({ readOnly: true });

        expect(labels(wrapper)).toEqual([ 'Download' ]);
    });

    // No ?disposition=: the endpoint defaults to attachment. External, so the router doesn't take the API route.
    it('links Download to the file\'s download endpoint, outside the router', () =>
    {
        const wrapper = mountMenu();

        const download = wrapper.get('a.item');
        expect(download.attributes('href')).toBe('/api/nodes/f1/download');
        expect(download.attributes('data-external')).toBe('true');
    });

    it('opens the rename modal from Rename file', async () =>
    {
        openRename.mockClear();
        const wrapper = mountMenu();

        await wrapper.get('button.item').trigger('click');

        expect(openRename).toHaveBeenCalledTimes(1);
    });

    it('leaves focus in a dialog an entry opened, and returns it to the trigger otherwise', () =>
    {
        const wrapper = mountMenu();
        const content = wrapper.findComponent({ name: 'UDropdownMenu' }).props('content') as
            { onCloseAutoFocus : (event : Event) => void };
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const field = document.createElement('input');
        dialog.appendChild(field);
        document.body.appendChild(dialog);

        field.focus();
        const intoDialog = new Event('focus', { cancelable: true });
        content.onCloseAutoFocus(intoDialog);

        field.blur();
        const dismissed = new Event('focus', { cancelable: true });
        content.onCloseAutoFocus(dismissed);

        dialog.remove();
        expect(intoDialog.defaultPrevented).toBe(true);
        expect(dismissed.defaultPrevented).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
