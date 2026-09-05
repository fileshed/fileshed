//----------------------------------------------------------------------------------------------------------------------
// Selection Bar — overflow menu
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

// Under test
import SelectionBar from '@client/components/drive/selectionBar.vue';

//----------------------------------------------------------------------------------------------------------------------

interface MenuItem
{
    label : string;
    disabled ?: boolean;
    onSelect ?: () => void;
}

// The kebab renders its items as buttons so a menu action is inspectable and clickable, exactly as the real dropdown
// would invoke each item's onSelect.
const STUBS = {
    UTooltip: { template: '<div><slot /></div>' },
    UButton: { props: [ 'label' ], template: '<button class="ubtn">{{ label }}</button>' },
    UIcon: true,
    UDropdownMenu: defineComponent({
        props: { items: { type: Array as () => MenuItem[][], default: () => [] } },
        computed: { flat() : MenuItem[] { return this.items.flat(); } },
        template: '<div class="overflow-menu"><button v-for="item in flat" :key="item.label" class="menu-item" '
            + ':disabled="item.disabled" @click="item.onSelect && item.onSelect()">{{ item.label }}</button>'
            + '<slot /></div>',
    }),
};

const FULL_CAPS = {
    count: 2,
    canCopy: true,
    copyTooltip: 'Make a copy',
    canRename: true,
    canShare: true,
    canMove: true,
    canTrash: true,
    trashLabel: 'Trash',
};

function mountBar(overrides : Partial<typeof FULL_CAPS> = {}) : VueWrapper
{
    return mount(SelectionBar, { props: { ...FULL_CAPS, ...overrides }, global: { stubs: STUBS } });
}

function overflowItems(wrapper : VueWrapper) : ReturnType<VueWrapper['findAll']>
{
    return wrapper.findAll('.overflow-menu .menu-item');
}

//----------------------------------------------------------------------------------------------------------------------

describe('SelectionBar — overflow menu', () =>
{
    // Copy and Rename are the two the narrow bar hides; the menu is the only way to reach them there, so it must
    // carry both.
    it('offers Copy and Rename, the actions the narrow bar hides', () =>
    {
        const wrapper = mountBar();

        expect(overflowItems(wrapper).map((item) => item.text())).toEqual([ 'Copy', 'Rename' ]);
    });

    // Rename is ownership-gated and only ever applies to a single node; when the caps withhold it, no rendering of
    // the bar may offer it.
    it('drops Rename when the selection cannot be renamed', () =>
    {
        const wrapper = mountBar({ canRename: false });

        expect(overflowItems(wrapper).map((item) => item.text())).toEqual([ 'Copy' ]);
    });

    // A folder can't be copied, but the action stays visible and disabled -- the wide bar does the same, and an
    // action that simply vanishes leaves the reason unsaid.
    it('keeps Copy present but disabled when the selection cannot be copied', () =>
    {
        const wrapper = mountBar({ canCopy: false });

        const copy = overflowItems(wrapper)[0];
        expect(copy?.text()).toBe('Copy');
        expect(copy?.attributes('disabled')).toBeDefined();
    });

    it('enables Copy when the selection is copyable', () =>
    {
        const wrapper = mountBar({ canCopy: true });

        expect(overflowItems(wrapper)[0]?.attributes('disabled')).toBeUndefined();
    });

    // Choosing from the menu must ask the page for the same thing the wide bar's button asks for.
    it('emits the same intents the wide bar emits when a menu action is chosen', async () =>
    {
        const wrapper = mountBar();
        const [ copy, rename ] = overflowItems(wrapper);

        await copy?.trigger('click');
        await rename?.trigger('click');

        expect(wrapper.emitted('copy')).toHaveLength(1);
        expect(wrapper.emitted('rename')).toHaveLength(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
