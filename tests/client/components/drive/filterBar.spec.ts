//----------------------------------------------------------------------------------------------------------------------
// Filter Bar — grid-view sort control
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { useDriveStore } from '@client/stores/drive.ts';

// Under test
import FilterBar from '@client/components/drive/filterBar.vue';

//----------------------------------------------------------------------------------------------------------------------

// The chips are popovers whose triggers render in the default slot; their content slots (calendar, owner list) stay
// closed, so only the trigger stubs matter. The sort menu carries a class hook so its presence and label are queryable.
const STUBS = {
    USelectMenu: { template: '<div><slot /></div>' },
    UPopover: { template: '<div><slot /></div>' },
    UButton: { props: [ 'label' ], template: '<button>{{ label }}</button>' },
    UDropdownMenu: { name: 'UDropdownMenu', template: '<div class="sort-menu"><slot /></div>' },
    UIcon: true,
    UAvatar: true,
    USeparator: true,
    UCalendar: true,
};

function mountBar(viewMode : 'grid' | 'list') : VueWrapper
{
    return mount(FilterBar, { props: { viewMode }, global: { stubs: STUBS } });
}

//----------------------------------------------------------------------------------------------------------------------

describe('FilterBar — sort control', () =>
{
    beforeEach(() => setActivePinia(createPinia()));

    it('shows the sort menu labelled with the current sort key in grid view', () =>
    {
        const wrapper = mountBar('grid');

        expect(wrapper.find('.sort-menu').exists()).toBe(true);
        expect(wrapper.find('.sort-menu').text()).toContain('Name');
    });

    it('reflects a changed sort key in the sort label', async () =>
    {
        const store = useDriveStore();
        const wrapper = mountBar('grid');

        store.sortKey = 'size';
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.sort-menu').text()).toContain('Size');
    });

    it('hides the sort menu in list view, where the column headers sort instead', () =>
    {
        const wrapper = mountBar('list');

        expect(wrapper.find('.sort-menu').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
