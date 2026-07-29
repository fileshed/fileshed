//----------------------------------------------------------------------------------------------------------------------
// Connected Accounts — the sign-in methods attached to an account
//
// The rows come from two sources crossed: the account's linked methods and the providers the running instance
// offers. Credential shows only when it exists; a provider shows when linked OR offered -- so a provider the
// admin later turned off stays visible and disconnectable, and an offered one invites connecting. Disconnect
// unlinks and re-reads; the last-method lockout is the server's refusal to surface, not a client guess.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

import type { InstanceResponse } from '@fileshed/core';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';
import { fetchInstance } from '@client/resource-access/instance.ts';

// Under test
import ConnectedAccounts from '@client/components/account/connectedAccounts.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({
    authClient: {
        listAccounts: vi.fn(),
        linkSocial: vi.fn(),
        unlinkAccount: vi.fn(),
    },
}));
vi.mock('@client/resource-access/instance.ts', () => ({ fetchInstance: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const listAccountsMock = authClient.listAccounts as unknown as Mock;
const unlinkMock = authClient.unlinkAccount as unknown as Mock;
const fetchInstanceMock = fetchInstance as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function instanceFixture(providers : InstanceResponse['providers']) : InstanceResponse
{
    return { needsSetup: false, signUpEnabled: true, emailEnabled: false, providers };
}

function accountsFixture(providerIDs : string[]) : { data : { providerId : string }[]; error : null }
{
    return { data: providerIDs.map((providerId) => ({ providerId })), error: null };
}

function mountAccounts() : VueWrapper
{
    return mount(ConnectedAccounts, {
        global: {
            stubs: {
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
                UIcon: true,
                UButton: {
                    name: 'UButton',
                    props: [ 'label', 'loading' ],
                    emits: [ 'click' ],
                    template: '<button :class="`btn-${ label?.toLowerCase() }`" '
                        + '@click="$emit(\'click\')">{{ label }}</button>',
                },
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('ConnectedAccounts', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
    });

    it('lists the credential method and offers a connect for each configured provider', async () =>
    {
        listAccountsMock.mockResolvedValue(accountsFixture([ 'credential' ]));
        fetchInstanceMock.mockResolvedValue(instanceFixture([ 'github' ]));
        const wrapper = mountAccounts();
        await flushPromises();

        expect(wrapper.text()).toContain('Email & password');
        expect(wrapper.text()).toContain('GitHub');
        expect(wrapper.text()).not.toContain('Google');
        expect(wrapper.find('.btn-connect').exists()).toBe(true);
        expect(wrapper.find('.btn-disconnect').exists()).toBe(false);
    });

    it('keeps a linked provider visible and disconnectable even when no longer offered', async () =>
    {
        listAccountsMock.mockResolvedValue(accountsFixture([ 'credential', 'github' ]));
        fetchInstanceMock.mockResolvedValue(instanceFixture([]));
        const wrapper = mountAccounts();
        await flushPromises();

        expect(wrapper.text()).toContain('GitHub');
        expect(wrapper.find('.btn-disconnect').exists()).toBe(true);
    });

    it('unlinks on disconnect and re-reads the methods', async () =>
    {
        listAccountsMock
            .mockResolvedValueOnce(accountsFixture([ 'credential', 'github' ]))
            .mockResolvedValueOnce(accountsFixture([ 'credential' ]));
        fetchInstanceMock.mockResolvedValue(instanceFixture([]));
        unlinkMock.mockResolvedValue({ data: {}, error: null });
        const wrapper = mountAccounts();
        await flushPromises();

        await wrapper.find('.btn-disconnect').trigger('click');
        await flushPromises();

        expect(unlinkMock).toHaveBeenCalledWith({ providerId: 'github' });
        expect(wrapper.find('.btn-disconnect').exists()).toBe(false);
    });

    it('never offers a disconnect for the credential method', async () =>
    {
        listAccountsMock.mockResolvedValue(accountsFixture([ 'credential' ]));
        fetchInstanceMock.mockResolvedValue(instanceFixture([]));
        const wrapper = mountAccounts();
        await flushPromises();

        expect(wrapper.text()).toContain('Email & password');
        expect(wrapper.find('.btn-disconnect').exists()).toBe(false);
    });

    it('shows the retry state when the methods cannot load', async () =>
    {
        listAccountsMock.mockRejectedValue(new Error('offline'));
        fetchInstanceMock.mockResolvedValue(instanceFixture([]));
        const wrapper = mountAccounts();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load your sign-in methods.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
