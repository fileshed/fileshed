//----------------------------------------------------------------------------------------------------------------------
// Delete User Modal — the confirmation in front of an irreversible delete
//
// Deleting an account takes its files with it and there is nothing behind it to undo from, so the dialog has to say
// what goes and refuse to act until the admin has typed the account's own email back. Typing the wrong address --
// the row above the one they meant -- must leave the button dead.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminUserResponse } from '@fileshed/core';

// Resource Access
import { deleteUser } from '@client/resource-access/admin.ts';

// Under test
import DeleteUserModal from '@client/components/admin/modals/deleteUserModal.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({ deleteUser: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const deleteUserMock = deleteUser as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function user(overrides : Partial<AdminUserResponse> = {}) : AdminUserResponse
{
    return {
        id: 'u1',
        email: 'member@example.com',
        name: 'Member',
        role: 'user',
        quotaLimit: null,
        quotaEffective: null,
        banned: false,
        banReason: null,
        banExpires: null,
        usedBytes: 0,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="confirm-input" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :class="`btn-${ label?.toLowerCase().replace(/ /g, \'-\') }`" :disabled="disabled" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title' ],
    template: '<div class="modal"><slot name="body" /></div>',
};
const UFormFieldStub = { name: 'UFormField', props: [ 'label' ], template: '<div><slot /></div>' };

async function mountModal(target : AdminUserResponse = user()) : Promise<VueWrapper>
{
    const wrapper = mount(DeleteUserModal, {
        global: {
            stubs: {
                UInput: UInputStub,
                UButton: UButtonStub,
                UModal: UModalStub,
                UFormField: UFormFieldStub,
            },
        },
    });

    (wrapper.vm as unknown as { open : (target : AdminUserResponse) => void }).open(target);
    await flushPromises();

    return wrapper;
}

function deleteButton(wrapper : VueWrapper) : HTMLButtonElement
{
    return wrapper.find('.btn-delete-account').element as HTMLButtonElement;
}

async function type(wrapper : VueWrapper, value : string) : Promise<void>
{
    wrapper.findComponent(UInputStub).vm.$emit('update:modelValue', value);
    await flushPromises();
}

//----------------------------------------------------------------------------------------------------------------------

describe('DeleteUserModal', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        deleteUserMock.mockResolvedValue(undefined);
    });

    it('names what the delete takes with it', async () =>
    {
        const wrapper = await mountModal();

        expect(wrapper.text()).toContain('can\'t be undone');
        expect(wrapper.text()).toContain('permanently deleted');
        expect(wrapper.text()).toContain('storage behind those files is released');
        expect(wrapper.text()).toContain('share they granted is revoked');
    });

    it('holds the delete until the account\'s own email is typed back', async () =>
    {
        const wrapper = await mountModal();

        expect(deleteButton(wrapper).disabled).toBe(true);

        await type(wrapper, 'member@example.com');

        expect(deleteButton(wrapper).disabled).toBe(false);
    });

    // The address of the row above the one they meant is exactly the mistake this exists to catch.
    it('refuses a different account\'s email', async () =>
    {
        const wrapper = await mountModal();

        await type(wrapper, 'root@example.com');

        expect(deleteButton(wrapper).disabled).toBe(true);

        await wrapper.find('.btn-delete-account').trigger('click');
        await flushPromises();

        expect(deleteUserMock).not.toHaveBeenCalled();
    });

    // Case and stray whitespace are copy-paste artifacts, not the mistake being guarded against.
    it('accepts the email in any case, with space around it', async () =>
    {
        const wrapper = await mountModal();

        await type(wrapper, '  MEMBER@Example.com ');

        expect(deleteButton(wrapper).disabled).toBe(false);
    });

    it('deletes the account and reports which one went', async () =>
    {
        const target = user({ id: 'u9', email: 'leaver@example.com' });
        const wrapper = await mountModal(target);

        await type(wrapper, 'leaver@example.com');
        await wrapper.find('.btn-delete-account').trigger('click');
        await flushPromises();

        expect(deleteUserMock).toHaveBeenCalledWith('u9');
        expect(wrapper.emitted('deleted')?.[0]).toEqual([ target ]);
    });

    // A rejected delete leaves the account standing, so the dialog stays up saying so rather than vanishing over a
    // listing that still shows the row.
    it('says nothing was deleted when the request fails', async () =>
    {
        deleteUserMock.mockRejectedValue(new Error('nope'));
        const wrapper = await mountModal();

        await type(wrapper, 'member@example.com');
        await wrapper.find('.btn-delete-account').trigger('click');
        await flushPromises();

        expect(wrapper.emitted('deleted')).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
