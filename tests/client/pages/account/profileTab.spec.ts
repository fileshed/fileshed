//----------------------------------------------------------------------------------------------------------------------
// Profile Tab — avatar handoff, badge, and display-name form
//
// Only the avatar/me/auth RAs are mocked; the real session store runs, so a name save proves the whole path -- the
// store adopts the refreshed profile the server returns. The avatar edit modal is stubbed to prove only the handoff:
// clicking the avatar (or the button beside it) opens it. Save is a plain form field, live only for a non-empty,
// changed name, submitting the trimmed value.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse } from '@fileshed/core';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';
import { fetchMe } from '@client/resource-access/me.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import ProfileTab from '@client/pages/account/profileTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { updateUser: vi.fn() } }));
vi.mock('@client/resource-access/avatar.ts', () => ({ uploadAvatar: vi.fn(), deleteAvatar: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));

const toastAdd = vi.fn();
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const updateUserMock = authClient.updateUser as unknown as Mock;
const fetchMeMock = fetchMe as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function meFixture(overrides : Partial<MeResponse> = {}) : MeResponse
{
    return {
        id: 'user_1',
        email: 'member@example.com',
        name: 'Ada Lovelace',
        role: 'user',
        quota: { used: 0, limit: null },
        preferences: {},
        image: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

const UAvatarStub = {
    name: 'UAvatar',
    props: [ 'src', 'alt' ],
    template: '<div class="avatar" :data-src="src" :data-alt="alt"></div>',
};

const UButtonStub = {
    name: 'UButton',
    props: [ 'label', 'disabled', 'loading' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || null" @click="$emit(\'click\')">{{ label }}</button>',
};

const UBadgeStub = { name: 'UBadge', props: [ 'label' ], template: '<span class="badge">{{ label }}</span>' };

const UInputStub = {
    name: 'UInput',
    props: {
        modelValue: { default: '' },
        readonly: { type: Boolean, default: false },
        disabled: { type: Boolean, default: false },
    },
    emits: [ 'update:modelValue' ],
    template: '<input class="u-input" :value="modelValue" :readonly="readonly || null" :disabled="disabled || null" '
        + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const UFormFieldStub = {
    name: 'UFormField',
    props: [ 'label' ],
    template: '<label class="form-field" :data-label="label"><slot /></label>',
};

const openAvatarEditMock = vi.fn();

const AvatarEditModalStub = {
    name: 'AvatarEditModal',
    template: '<div class="avatar-edit-modal-stub" />',
    methods: { open: openAvatarEditMock },
};

function mountTab() : VueWrapper
{
    return mount(ProfileTab, {
        global: {
            stubs: {
                UAvatar: UAvatarStub,
                UButton: UButtonStub,
                UBadge: UBadgeStub,
                UInput: UInputStub,
                UFormField: UFormFieldStub,
                AvatarEditModal: AvatarEditModalStub,
                UIcon: true,
            },
        },
    });
}

function button(wrapper : VueWrapper, label : string) : ReturnType<VueWrapper['get']>
{
    return wrapper.get(`button[data-label="${ label }"]`);
}

function nameInput(wrapper : VueWrapper) : ReturnType<VueWrapper['get']>
{
    return wrapper.get('input.u-input:not([disabled])');
}

//----------------------------------------------------------------------------------------------------------------------

describe('ProfileTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Avatar
    //------------------------------------------------------------------------------------------------------------------

    it('opens the avatar editor when the avatar itself is clicked', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const wrapper = mountTab();

        await wrapper.get('button[aria-label="Change avatar"]').trigger('click');

        expect(openAvatarEditMock).toHaveBeenCalledOnce();
    });

    it('opens the avatar editor from the Change avatar button beside it', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture();
        const wrapper = mountTab();

        await button(wrapper, 'Change avatar').trigger('click');

        expect(openAvatarEditMock).toHaveBeenCalledOnce();
    });

    it('binds the avatar image from the profile when one is set', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ image: '/api/avatars/abc123' });

        const wrapper = mountTab();

        expect(wrapper.find('.avatar').attributes('data-src')).toBe('/api/avatars/abc123');
    });

    //------------------------------------------------------------------------------------------------------------------
    // Admin badge
    //------------------------------------------------------------------------------------------------------------------

    it('shows the Admin badge beside the name for an admin', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ role: 'admin' });

        const wrapper = mountTab();

        expect(wrapper.find('.badge').exists()).toBe(true);
    });

    it('shows no Admin badge for a non-admin', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ role: 'user' });

        const wrapper = mountTab();

        expect(wrapper.find('.badge').exists()).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Email
    //------------------------------------------------------------------------------------------------------------------

    it('shows the email as muted text under the name, not as a field', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ email: 'ada@example.com' });

        const wrapper = mountTab();

        expect(wrapper.text()).toContain('ada@example.com');
        expect(wrapper.find('input.u-input[disabled]').exists()).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Display name
    //------------------------------------------------------------------------------------------------------------------

    it('prefills the name field with the stored name', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ name: 'Ada Lovelace' });

        const wrapper = mountTab();

        expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('Ada Lovelace');
    });

    it('leaves Save disabled while the draft matches the stored name', () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ name: 'Ada Lovelace' });

        const wrapper = mountTab();

        expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
    });

    it('leaves Save disabled when the draft is emptied to whitespace', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ name: 'Ada Lovelace' });
        const wrapper = mountTab();

        await nameInput(wrapper).setValue('   ');

        expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
    });

    it('saves a trimmed new name and the store adopts the refreshed profile', async () =>
    {
        const session = useSessionStore();
        session.me = meFixture({ name: 'Ada Lovelace' });
        updateUserMock.mockResolvedValue({ error: null });
        fetchMeMock.mockResolvedValue(meFixture({ name: 'Ada L.' }));
        const wrapper = mountTab();

        await nameInput(wrapper).setValue('  Ada L.  ');
        await button(wrapper, 'Save').trigger('click');
        await flushPromises();

        expect(updateUserMock).toHaveBeenCalledWith({ name: 'Ada L.' });
        expect(session.me?.name).toBe('Ada L.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
