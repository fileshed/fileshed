//----------------------------------------------------------------------------------------------------------------------
// Admin Email Tab — SMTP composition and the test-send
//
// The tab renders every mail key as a field under its group -- the six SMTP knobs and the boot-frozen verification
// requirement -- and the test-send button drives the admin test endpoint, toasting the recipient on success. A
// failed load shows the retry state.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminSettingEntry, AdminSettingsResponse } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { fetchAdminSettings, sendTestEmail } from '@client/resource-access/admin.ts';

// Components
import SettingField from '@client/components/admin/settingField.vue';

// Under test
import EmailTab from '@client/pages/admin/emailTab.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
    sendTestEmail: vi.fn(),
}));

const toastAdd = vi.fn();
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: toastAdd }) }));

const fetchMock = fetchAdminSettings as unknown as Mock;
const sendTestMock = sendTestEmail as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function mailView() : AdminSettingsResponse
{
    const base = { secret: false, requiresRestart: false, source: 'default' as const };

    const settings : AdminSettingEntry[] = [
        { hasDefault: true, key: 'SMTP_HOST', kind: 'string', value: null, ...base },
        { hasDefault: true, key: 'SMTP_PORT', kind: 'number', value: 587, ...base },
        { hasDefault: true, key: 'SMTP_SECURE', kind: 'boolean', value: false, ...base },
        { hasDefault: true, key: 'SMTP_USER', kind: 'string', value: null, ...base },
        { hasDefault: true, key: 'SMTP_PASSWORD', kind: 'string', value: null, ...base, secret: true },
        { hasDefault: true, key: 'SMTP_FROM', kind: 'string', value: null, ...base },
        {
            key: 'EMAIL_VERIFICATION_REQUIRED',
            kind: 'boolean',
            value: false,
            ...base,
            requiresRestart: true,
            hasDefault: true,
        },
    ];

    return { settings, restartRequired: false };
}

function mountTab() : VueWrapper
{
    return mount(EmailTab, {
        global: {
            stubs: {
                SettingField: true,
                RestartBanner: true,
                UAlert: { name: 'UAlert', props: [ 'title' ], template: '<div class="alert">{{ title }}</div>' },
                UButton: {
                    name: 'UButton',
                    props: [ 'label', 'loading' ],
                    emits: [ 'click' ],
                    template: '<button class="test-btn" @click="$emit(\'click\')">{{ label }}</button>',
                },
            },
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('Admin EmailTab', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('renders every mail key under its group heading', async () =>
    {
        fetchMock.mockResolvedValue(mailView());
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.findAll('h2').map((heading) => heading.text())).toEqual([ 'SMTP server', 'Accounts', 'Test' ]);

        const keys = wrapper.findAllComponents(SettingField).map((field) => field.props('entry').key);
        expect(keys).toEqual([
            'SMTP_HOST',
            'SMTP_PORT',
            'SMTP_SECURE',
            'SMTP_USER',
            'SMTP_PASSWORD',
            'SMTP_FROM',
            'EMAIL_VERIFICATION_REQUIRED',
        ]);
    });

    it('sends the test email and toasts the recipient', async () =>
    {
        fetchMock.mockResolvedValue(mailView());
        sendTestMock.mockResolvedValue({ to: 'root@example.com' });
        const wrapper = mountTab();
        await flushPromises();

        await wrapper.find('.test-btn').trigger('click');
        await flushPromises();

        expect(sendTestMock).toHaveBeenCalled();
        expect(toastAdd).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Test email sent to root@example.com.' })
        );
    });

    it('toasts the server\'s reason when the test-send fails', async () =>
    {
        fetchMock.mockResolvedValue(mailView());
        sendTestMock.mockRejectedValue(
            new ApiError(400, 'The SMTP server refused the send: 535 Authentication failed')
        );
        const wrapper = mountTab();
        await flushPromises();

        await wrapper.find('.test-btn').trigger('click');
        await flushPromises();

        expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
            color: 'error',
            description: expect.stringContaining('535 Authentication failed'),
        }));
    });

    it('shows the retry state when the load fails', async () =>
    {
        fetchMock.mockRejectedValue(new Error('offline'));
        const wrapper = mountTab();
        await flushPromises();

        expect(wrapper.find('.alert').text()).toContain('Couldn\'t load the instance settings.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
