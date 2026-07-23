//----------------------------------------------------------------------------------------------------------------------
// Change Password — confirm gate, success, and failure
//
// Only the better-auth client seam is mocked; the real session store runs, so a submit proves the whole path down to
// authClient.changePassword. The confirm field must match the new password before Update is live -- the sole client
// gate. A success clears the fields and toasts; a failure toasts and keeps the fields so the user can retry.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';

// Under test
import ChangePassword from '@client/components/account/changePassword.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { changePassword: vi.fn() } }));
vi.mock('@client/resource-access/avatar.ts', () => ({ uploadAvatar: vi.fn(), deleteAvatar: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));

const toastAdd = vi.fn();
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const changePasswordMock = authClient.changePassword as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UInputStub = {
    name: 'UInput',
    props: [ 'modelValue', 'type' ],
    emits: [ 'update:modelValue' ],
    template: '<input class="u-input" :value="modelValue" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || null" @click="$emit(\'click\')">{{ label }}</button>',
};

const UFormFieldStub = {
    name: 'UFormField',
    props: [ 'label', 'error' ],
    template: '<label class="form-field" :data-error="error"><slot /></label>',
};

const UCheckboxStub = {
    name: 'UCheckbox',
    props: [ 'modelValue', 'label' ],
    emits: [ 'update:modelValue' ],
    template: '<input type="checkbox" class="u-checkbox" :checked="modelValue" '
        + '@change="$emit(\'update:modelValue\', $event.target.checked)" />',
};

function mountControl() : VueWrapper
{
    return mount(ChangePassword, {
        global: {
            stubs: {
                UInput: UInputStub,
                UButton: UButtonStub,
                UFormField: UFormFieldStub,
                UCheckbox: UCheckboxStub,
            },
        },
    });
}

function updateButton(wrapper : VueWrapper) : ReturnType<VueWrapper['get']>
{
    return wrapper.get('button[data-label="Update password"]');
}

// The three password fields in template order: current, new, confirm.
async function fill(wrapper : VueWrapper, current : string, next : string, confirm : string) : Promise<void>
{
    const inputs = wrapper.findAll('input.u-input');
    await inputs[0]?.setValue(current);
    await inputs[1]?.setValue(next);
    await inputs[2]?.setValue(confirm);
}

//----------------------------------------------------------------------------------------------------------------------

describe('ChangePassword', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('keeps Update disabled while the confirmation does not match the new password', async () =>
    {
        const wrapper = mountControl();

        await fill(wrapper, 'old-secret', 'new-secret', 'different');

        expect(updateButton(wrapper).attributes('disabled')).toBeDefined();
    });

    it('keeps Update disabled until every field is filled', async () =>
    {
        const wrapper = mountControl();

        await fill(wrapper, '', 'new-secret', 'new-secret');

        expect(updateButton(wrapper).attributes('disabled')).toBeDefined();
    });

    it('submits the entered current and new passwords once the confirmation matches', async () =>
    {
        changePasswordMock.mockResolvedValue({ error: null });
        const wrapper = mountControl();
        await fill(wrapper, 'old-secret', 'new-secret', 'new-secret');

        await updateButton(wrapper).trigger('click');
        await flushPromises();

        expect(changePasswordMock).toHaveBeenCalledWith({
            currentPassword: 'old-secret',
            newPassword: 'new-secret',
            revokeOtherSessions: false,
        });
    });

    it('carries the revoke-other-sessions opt-in through to the change when checked', async () =>
    {
        changePasswordMock.mockResolvedValue({ error: null });
        const wrapper = mountControl();
        await fill(wrapper, 'old-secret', 'new-secret', 'new-secret');
        await wrapper.get('input.u-checkbox').setValue(true);

        await updateButton(wrapper).trigger('click');
        await flushPromises();

        expect(changePasswordMock).toHaveBeenCalledWith(expect.objectContaining({ revokeOtherSessions: true }));
    });

    it('clears the fields and toasts success after a successful change', async () =>
    {
        changePasswordMock.mockResolvedValue({ error: null });
        const wrapper = mountControl();
        await fill(wrapper, 'old-secret', 'new-secret', 'new-secret');

        await updateButton(wrapper).trigger('click');
        await flushPromises();

        const inputs = wrapper.findAll('input.u-input');
        expect(inputs.every((input) => (input.element as HTMLInputElement).value === '')).toBe(true);
        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }));
    });

    it('toasts and keeps the entered values when the change fails', async () =>
    {
        changePasswordMock.mockResolvedValue({ error: { message: 'Wrong password.' } });
        const wrapper = mountControl();
        await fill(wrapper, 'wrong-current', 'new-secret', 'new-secret');

        await updateButton(wrapper).trigger('click');
        await flushPromises();

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }));
        const inputs = wrapper.findAll('input.u-input');
        expect((inputs[0]?.element as HTMLInputElement).value).toBe('wrong-current');
        expect((inputs[1]?.element as HTMLInputElement).value).toBe('new-secret');
    });
});

//----------------------------------------------------------------------------------------------------------------------
