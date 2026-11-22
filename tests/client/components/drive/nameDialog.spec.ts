//----------------------------------------------------------------------------------------------------------------------
// Name Dialog — the selection it opens with
//
// The contract: with excludeExtension, the dialog opens with the name selected up to its extension, so typing
// replaces the name and keeps the extension; a name with no extension, or a dotfile whose only dot leads it, opens
// fully selected. Without the option the modal's own select-all stands.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

// Under test
import NameDialog from '@client/components/drive/nameDialog.vue';

//----------------------------------------------------------------------------------------------------------------------

interface AutoFocusContent { onOpenAutoFocus ?: (event : Event) => void }

const stubs = {
    UModal: {
        name: 'UModal',
        props: [ 'open', 'title', 'dismissible', 'content' ],
        template: '<div v-if="open"><slot name="body" /></div>',
    },
    UForm: { template: '<form><slot /></form>' },
    UFormField: { template: '<div><slot /></div>' },
    UButton: { template: '<button />' },
    UInput: defineComponent({
        props: { modelValue: { type: String, default: '' } },
        setup(props, { expose })
        {
            const inputRef = ref<HTMLInputElement | null>(null);
            expose({ inputRef });

            return () => h('input', { ref: inputRef, value: props.modelValue });
        },
    }),
};

let wrapper : VueWrapper | null = null;

interface Opened
{
    input : HTMLInputElement;
    event : Event;
}

async function openWith(initial : string, excludeExtension : boolean) : Promise<Opened>
{
    wrapper = mount(NameDialog, {
        props: { title: 'Rename file', label: 'Name', submitLabel: 'Save', initial, excludeExtension, open: false },
        global: { stubs },
        attachTo: document.body,
    });
    await wrapper.setProps({ open: true });
    await nextTick();

    const event = new Event('focus', { cancelable: true });
    const content = wrapper.findComponent({ name: 'UModal' }).props('content') as AutoFocusContent;
    content.onOpenAutoFocus?.(event);

    return { input: wrapper.get('input').element, event };
}

afterEach(() =>
{
    wrapper?.unmount();
    wrapper = null;
});

//----------------------------------------------------------------------------------------------------------------------

describe('NameDialog', () =>
{
    it('opens with the name selected up to its extension', async () =>
    {
        const { input, event } = await openWith('hello-world.md', true);

        expect(event.defaultPrevented).toBe(true);
        expect([ input.selectionStart, input.selectionEnd ]).toEqual([ 0, 11 ]);
    });

    it('selects the whole name when it has no extension, a dotfile included', async () =>
    {
        const { input } = await openWith('.gitignore', true);

        expect([ input.selectionStart, input.selectionEnd ]).toEqual([ 0, 10 ]);
    });

    it('leaves the opening selection to the modal without excludeExtension', async () =>
    {
        const { event } = await openWith('hello-world.md', false);

        expect(event.defaultPrevented).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
