//----------------------------------------------------------------------------------------------------------------------
// Delete Account Modal — the confirm, and what lands after it
//
// The real session store runs; only the wire is mocked. Two things have to be said before the click, because they
// happen at different times and only one is reversible: the files wait out the window and come back if the person
// cancels, the shares and links and tokens go now and stay gone. The window named is the deployment's own, since an
// instance that moved it must not be described by the number this bundle was built against.
//
// Every session ends with the request, this one included, so on success the app must not pretend it survived.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { requestAccountDeletion } from '@client/resource-access/me.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../../../support.ts';

// Under test
import DeleteAccountModal from '@client/components/account/modals/deleteAccountModal.vue';

//----------------------------------------------------------------------------------------------------------------------

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: routerReplace }) }));
vi.mock('@client/resource-access/me.ts', () => ({ requestAccountDeletion: vi.fn(), fetchMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const requestMock = requestAccountDeletion as unknown as Mock;

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

async function openModal(windowDays = 30) : Promise<VueWrapper>
{
    const wrapper = mount(DeleteAccountModal, {
        props: { windowDays },
        global: { stubs: { UModal: UModalStub, UButton: UButtonStub } },
    });

    (wrapper.vm as unknown as ModalHandle).open();
    await flushPromises();

    return wrapper;
}

function confirmButton(wrapper : VueWrapper) : ReturnType<VueWrapper['get']>
{
    return wrapper.get('button[data-label="Delete my account"]');
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    requestMock.mockResolvedValue(meFixture());
    useSessionStore().me = meFixture();
});

//----------------------------------------------------------------------------------------------------------------------

describe('DeleteAccountModal', () =>
{
    it('asks for nothing until the confirm is clicked', async () =>
    {
        const wrapper = await openModal();

        expect(wrapper.get('.modal').attributes('data-open')).toBe('true');
        expect(requestMock).not.toHaveBeenCalled();
    });

    it('names the deployment\'s own window rather than the shipped default', async () =>
    {
        expect((await openModal(7)).text()).toContain('7 days');
        expect((await openModal(1)).text()).toContain('1 day');
    });

    // A person who reads only "my account is deleted in 30 days" will not expect their shares to stop working this
    // afternoon, so the dialog says which half happens when, and that cancelling undoes only one of them.
    it('separates what waits from what goes immediately', async () =>
    {
        const wrapper = await openModal();

        expect(wrapper.text()).toContain('sign in and cancel');
        expect(wrapper.text()).toContain('Every share you granted is revoked');
        expect(wrapper.text()).toContain('It does not bring those back.');
    });

    it('offers the confirm as the destructive action', async () =>
    {
        expect(confirmButton(await openModal()).attributes('data-color')).toBe('error');
    });

    it('drops the signed-in state and lands on sign-in once the request succeeds', async () =>
    {
        const session = useSessionStore();
        const wrapper = await openModal();

        await confirmButton(wrapper).trigger('click');
        await flushPromises();

        expect(requestMock).toHaveBeenCalledTimes(1);
        expect(session.isAuthenticated).toBe(false);
        expect(routerReplace).toHaveBeenCalledWith({ path: '/signin', query: { reason: 'deletion-requested' } });
        expect(wrapper.get('.modal').attributes('data-open')).toBe('false');
    });

    it('keeps the session and the dialog when the request fails', async () =>
    {
        requestMock.mockRejectedValue(new Error('the database went away'));
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
