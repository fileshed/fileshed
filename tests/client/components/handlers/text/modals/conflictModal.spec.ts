//----------------------------------------------------------------------------------------------------------------------
// Conflict Modal — the save-conflict resolution contract
//
// The modal offers exactly two resolutions and emits the caller's choice; the actions themselves live on the editor
// store, so this asserts only the contract: the right event fires for the right button, an in-flight overwrite locks
// the choices, and a closed modal renders nothing. Nuxt UI's modal and button are stubbed to plain elements so the
// events and disabled/loading state are directly observable.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';

// Under test
import ConflictModal from '@client/components/handlers/text/modals/conflictModal.vue';

//----------------------------------------------------------------------------------------------------------------------

// The modal renders its body only when open, mirroring the real UModal.
const UModalStub = {
    name: 'UModal',
    props: [ 'open' ],
    template: '<div v-if="open" class="u-modal"><slot name="body" /></div>',
};

// A button that reflects its label, disabled, and loading state and forwards clicks -- enough to assert the contract.
const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || loading" '
        + ':data-loading="String(Boolean(loading))" @click="$emit(\'click\')">{{ label }}</button>',
};

function mountModal(props : { open : boolean; busy ?: boolean }) : VueWrapper
{
    return mount(ConflictModal, {
        props,
        global: { stubs: { UModal: UModalStub, UButton: UButtonStub } },
    });
}

function button(wrapper : VueWrapper, label : string) : ReturnType<VueWrapper['get']>
{
    return wrapper.get(`button[data-label="${ label }"]`);
}

//----------------------------------------------------------------------------------------------------------------------

describe('ConflictModal', () =>
{
    it('emits reload when Reload is clicked', async () =>
    {
        const wrapper = mountModal({ open: true });

        await button(wrapper, 'Reload').trigger('click');

        expect(wrapper.emitted('reload')).toHaveLength(1);
        expect(wrapper.emitted('overwrite')).toBeUndefined();
    });

    it('emits overwrite when Overwrite is clicked', async () =>
    {
        const wrapper = mountModal({ open: true });

        await button(wrapper, 'Overwrite').trigger('click');

        expect(wrapper.emitted('overwrite')).toHaveLength(1);
        expect(wrapper.emitted('reload')).toBeUndefined();
    });

    it('locks both choices while an overwrite is in flight', () =>
    {
        const wrapper = mountModal({ open: true, busy: true });

        expect(button(wrapper, 'Reload').attributes('disabled')).toBeDefined();
        expect(button(wrapper, 'Overwrite').attributes('data-loading')).toBe('true');
    });

    it('renders nothing when closed', () =>
    {
        const wrapper = mountModal({ open: false });

        expect(wrapper.find('.u-modal').exists()).toBe(false);
        expect(wrapper.findAll('button')).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
