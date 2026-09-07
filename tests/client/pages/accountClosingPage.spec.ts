//----------------------------------------------------------------------------------------------------------------------
// Account Closing Page — the only page an account on its way out can reach
//
// The server refuses that account everywhere else, so this page carries the whole story: the date, what is and is not
// coming back, and the one action still open. The date is the deployment's answer for this request, not a countdown
// the browser computes.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { cancelAccountDeletion } from '@client/resource-access/me.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { meFixture } from '../support.ts';

// Under test
import AccountClosingPage from '@client/pages/accountClosingPage.vue';

//----------------------------------------------------------------------------------------------------------------------

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('@client/resource-access/me.ts', () => ({ cancelAccountDeletion: vi.fn(), fetchMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const cancelMock = cancelAccountDeletion as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const UCardStub = {
    name: 'UCard',
    template: '<div class="card"><slot name="header" /><slot /></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled" @click="$emit(\'click\')" />',
};

const SCHEDULE = {
    requestedAt: '2026-09-06T12:00:00.000Z',
    scheduledFor: '2026-10-06T12:00:00.000Z',
};

function mountPage() : VueWrapper
{
    return mount(AccountClosingPage, {
        global: { stubs: { UCard: UCardStub, UButton: UButtonStub } },
    });
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();
    cancelMock.mockResolvedValue(meFixture({ deletion: null }));
    useSessionStore().me = meFixture({ email: 'leaving@example.com', deletion: SCHEDULE });
});

//----------------------------------------------------------------------------------------------------------------------

describe('AccountClosingPage', () =>
{
    it('names the account and the date it goes', () =>
    {
        const wrapper = mountPage();

        expect(wrapper.text()).toContain('leaving@example.com');
        expect(wrapper.text()).toContain(new Date(SCHEDULE.scheduledFor).toLocaleDateString(undefined, {
            dateStyle: 'long',
        }));
    });

    // Cancelling brings the account back and none of the reach with it, and somebody deciding whether to cancel is
    // exactly who needs to know that.
    it('says what cancelling does and does not restore', () =>
    {
        const wrapper = mountPage();

        expect(wrapper.text()).toContain('come back if you cancel');
        expect(wrapper.text()).toContain('does not bring those back');
    });

    it('cancels the deletion and returns to the drive', async () =>
    {
        const session = useSessionStore();
        const wrapper = mountPage();

        await wrapper.get('button[data-label="Keep my account"]').trigger('click');
        await flushPromises();

        expect(cancelMock).toHaveBeenCalledTimes(1);
        expect(session.isClosing).toBe(false);
        expect(routerPush).toHaveBeenCalledWith('/');
    });

    it('stays put when the cancel fails', async () =>
    {
        cancelMock.mockRejectedValue(new Error('the database went away'));
        const session = useSessionStore();
        const wrapper = mountPage();

        await wrapper.get('button[data-label="Keep my account"]').trigger('click');
        await flushPromises();

        expect(session.isClosing).toBe(true);
        expect(routerPush).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
