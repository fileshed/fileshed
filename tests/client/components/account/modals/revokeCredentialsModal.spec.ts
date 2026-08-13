//----------------------------------------------------------------------------------------------------------------------
// Revoke Credentials Modal — the confirm, and what lands after it
//
// The real session store runs; only the wire is mocked. Opening the dialog revokes nothing: it exists to say what
// the click will do, and it has to name both halves, since a user who reads only "sign out" will not expect their
// tokens to stop. On success the app must not pretend the session survived -- the signed-in state drops and the next
// thing on screen is sign-in. On failure nothing is claimed: the dialog stays, the session stays, and the user is
// still on the account page with a working session to retry from.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { revokeAllCredentials } from '@client/resource-access/credentials.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../../support.ts';

// Under test
import RevokeCredentialsModal from '@client/components/account/modals/revokeCredentialsModal.vue';

//----------------------------------------------------------------------------------------------------------------------

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: routerReplace }) }));
vi.mock('@client/resource-access/credentials.ts', () => ({ revokeAllCredentials: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const revokeMock = revokeAllCredentials as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UModalStub = {
    name: 'UModal',
    props: [ 'open', 'title' ],
    template: '<div class="modal" :data-open="String(open)"><slot name="body" /></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'color', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :data-color="color" :disabled="disabled" @click="$emit(\'click\')" />',
};

interface ModalHandle { open : () => void }

async function openModal() : Promise<VueWrapper>
{
    const wrapper = mount(RevokeCredentialsModal, {
        global: { stubs: { UModal: UModalStub, UButton: UButtonStub } },
    });

    (wrapper.vm as unknown as ModalHandle).open();
    await flushPromises();

    return wrapper;
}

function confirmButton(wrapper : VueWrapper) : ReturnType<VueWrapper['get']>
{
    return wrapper.get('button[data-label="Sign out everywhere"]');
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    revokeMock.mockResolvedValue(undefined);
    useSessionStore().me = meFixture();
});

//----------------------------------------------------------------------------------------------------------------------

describe('RevokeCredentialsModal', () =>
{
    it('names both halves and revokes nothing until the confirm is clicked', async () =>
    {
        const wrapper = await openModal();

        expect(wrapper.get('.modal').attributes('data-open')).toBe('true');
        expect(wrapper.text()).toContain('every device');
        expect(wrapper.text()).toContain('access token');
        expect(revokeMock).not.toHaveBeenCalled();
    });

    it('offers the confirm as the destructive action', async () =>
    {
        const wrapper = await openModal();

        expect(confirmButton(wrapper).attributes('data-color')).toBe('error');
    });

    it('drops the signed-in state and lands on sign-in once the revoke succeeds', async () =>
    {
        const session = useSessionStore();
        const wrapper = await openModal();

        await confirmButton(wrapper).trigger('click');
        await flushPromises();

        expect(revokeMock).toHaveBeenCalledTimes(1);
        expect(session.isAuthenticated).toBe(false);
        expect(routerReplace).toHaveBeenCalledWith({ path: '/signin', query: { reason: 'revoked' } });
        expect(wrapper.get('.modal').attributes('data-open')).toBe('false');
    });

    it('keeps the session and the dialog when the revoke fails', async () =>
    {
        revokeMock.mockRejectedValue(new Error('the database went away'));
        const session = useSessionStore();
        const wrapper = await openModal();

        await confirmButton(wrapper).trigger('click');
        await flushPromises();

        expect(session.isAuthenticated).toBe(true);
        expect(routerReplace).not.toHaveBeenCalled();
        expect(wrapper.get('.modal').attributes('data-open')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
