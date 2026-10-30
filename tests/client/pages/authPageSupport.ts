//----------------------------------------------------------------------------------------------------------------------
// Auth Page Spec Support
//
// The form stub submits whatever the fields hold without validating it: the schemas are Zod's and the validation run
// is Nuxt UI's, and a page spec is about what the page does with a submission that got through.
//----------------------------------------------------------------------------------------------------------------------

import type { Component } from 'vue';

import { type Router, createMemoryHistory, createRouter } from 'vue-router';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

//----------------------------------------------------------------------------------------------------------------------

const AUTH_STUBS = {
    UCard: { template: '<section><slot name="header" /><slot /><slot name="footer" /></section>' },
    UForm: {
        props: [ 'state', 'schema' ],
        emits: [ 'submit' ],
        template: '<form @submit.prevent="$emit(\'submit\', { data: state })"><slot /></form>',
    },
    UFormField: { props: [ 'label', 'name' ], template: '<label :data-field="name"><slot /></label>' },
    UInput: {
        props: [ 'modelValue', 'type' ],
        emits: [ 'update:modelValue' ],
        template: '<input :type="type" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UButton: {
        props: [ 'label', 'type', 'loading' ],
        emits: [ 'click' ],
        template: '<button :type="type ?? \'button\'" :data-label="label" @click="$emit(\'click\')">'
            + '{{ label }}</button>',
    },
    UAlert: {
        props: [ 'description', 'color' ],
        template: '<p role="alert" :data-color="color">{{ description }}</p>',
    },
    USeparator: true,
    UIcon: true,
};

export interface MountedAuthPage
{
    wrapper : VueWrapper;
    router : Router;
}

// Mounts `page` at `location`, with every route an auth page sends a visitor to registered as a blank target.
export async function mountAuthPage(page : Component, path : string, location : string) : Promise<MountedAuthPage>
{
    setActivePinia(createPinia());

    const blank = { template: '<div />' };
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path, component: page },
            ...[ '/', '/admin', '/setup', '/signin', '/signup', '/forgot-password', '/trash' ]
                .filter((target) => target !== path)
                .map((target) => ({ path: target, component: blank })),
        ],
    });
    await router.push(location);
    await router.isReady();

    const wrapper = mount(page, { global: { plugins: [ router ], stubs: AUTH_STUBS } });
    await flushPromises();

    return { wrapper, router };
}

export async function fillField(wrapper : VueWrapper, name : string, value : string) : Promise<void>
{
    await wrapper.get(`[data-field="${ name }"] input`).setValue(value);
}

export async function submit(wrapper : VueWrapper) : Promise<void>
{
    await wrapper.get('form').trigger('submit');
    await flushPromises();
}

export function alertText(wrapper : VueWrapper) : string | null
{
    const alert = wrapper.find('[role="alert"]');

    return alert.exists() ? alert.text() : null;
}

//----------------------------------------------------------------------------------------------------------------------
