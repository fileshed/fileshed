//----------------------------------------------------------------------------------------------------------------------
// Home View — smoke tests
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { createPinia } from 'pinia';
import { mount } from '@vue/test-utils';

import HomeView from '@client/views/homeView.vue';

//----------------------------------------------------------------------------------------------------------------------

// Nuxt UI's global components are registered by its Vite plugin, which isn't active under Vitest. Stub them to plain
// slot-rendering elements so the view mounts and we can assert what the user actually sees.
const stubs = {
    UCard: { template: '<div><slot /></div>' },
    UButton: { template: '<button><slot />{{ label }}</button>', props: [ 'label' ] },
};

//----------------------------------------------------------------------------------------------------------------------

describe('home view', () =>
{
    it('shows the FileShed name and tagline', () =>
    {
        const wrapper = mount(HomeView, {
            global: {
                plugins: [ createPinia() ],
                stubs,
            },
        });

        expect(wrapper.text()).toContain('FileShed');
        expect(wrapper.text()).toContain('Self-hosted, multi-user file hosting');
    });
});

//----------------------------------------------------------------------------------------------------------------------
