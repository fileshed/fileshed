//----------------------------------------------------------------------------------------------------------------------
// Access Token List — the inventory and the two-step revoke
//
// The contract: the list fetches on mount and renders each token's name, identifying start characters, and scope
// labels -- never a token value, which the API cannot even supply. Revoke arms on the first click and only fires on
// the confirming second, since a revoked credential cannot be un-revoked.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';

// Under test
import AccessTokenList from '@client/components/account/tokens/accessTokenList.vue';

//----------------------------------------------------------------------------------------------------------------------

const { listAccessTokensMock, revokeAccessTokenMock } = vi.hoisted(() => ({
    listAccessTokensMock: vi.fn(),
    revokeAccessTokenMock: vi.fn(),
}));

vi.mock('@client/resource-access/accessTokens.ts', () => ({
    listAccessTokens: listAccessTokensMock,
    revokeAccessToken: revokeAccessTokenMock,
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'color', 'variant', 'loading' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :data-color="color" @click="$emit(\'click\')">{{ label }}</button>',
};

const UBadgeStub = { name: 'UBadge', template: '<span class="u-badge"><slot /></span>' };

function tokenRow(overrides : Record<string, unknown> = {}) : Record<string, unknown>
{
    return {
        id: 'k1',
        name: 'backup script',
        start: 'fspat_abc123',
        scopes: [ 'files:download', 'files:read' ],
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        ...overrides,
    };
}

function mountList() : VueWrapper
{
    return mount(AccessTokenList, { global: { stubs: { UButton: UButtonStub, UBadge: UBadgeStub } } });
}

beforeEach(() =>
{
    vi.clearAllMocks();
    listAccessTokensMock.mockResolvedValue({ accessTokens: [ tokenRow() ] });
    revokeAccessTokenMock.mockResolvedValue(undefined);
});

//----------------------------------------------------------------------------------------------------------------------

describe('AccessTokenList', () =>
{
    it('renders each token\'s name, start characters, and scope labels -- never a value', async () =>
    {
        const wrapper = mountList();
        await flushPromises();

        expect(wrapper.text()).toContain('backup script');
        expect(wrapper.text()).toContain('fspat_abc123');
        expect(wrapper.text()).toContain('Download files');
        expect(wrapper.text()).toContain('Read files');
        expect(wrapper.text()).toContain('never used');
        expect(wrapper.text()).toContain('no expiry');
    });

    it('shows the empty invitation when there are no tokens', async () =>
    {
        listAccessTokensMock.mockResolvedValue({ accessTokens: [] });
        const wrapper = mountList();
        await flushPromises();

        expect(wrapper.text()).toContain('No access tokens yet.');
    });

    it('arms on the first revoke click and only revokes on the confirming second', async () =>
    {
        const wrapper = mountList();
        await flushPromises();

        await wrapper.get('button[data-label="Revoke"]').trigger('click');
        expect(revokeAccessTokenMock).not.toHaveBeenCalled();

        listAccessTokensMock.mockResolvedValue({ accessTokens: [] });
        await wrapper.get('button[data-label="Confirm revoke"]').trigger('click');
        await flushPromises();

        expect(revokeAccessTokenMock).toHaveBeenCalledWith('k1');
        expect(wrapper.text()).toContain('No access tokens yet.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
