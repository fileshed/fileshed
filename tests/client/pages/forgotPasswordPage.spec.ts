//----------------------------------------------------------------------------------------------------------------------
// Forgot Password Page
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';

// Support
import { type MountedAuthPage, alertText, fillField, mountAuthPage, submit } from './authPageSupport.ts';

// Under test
import ForgotPasswordPage from '@client/pages/forgotPasswordPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { requestPasswordReset: vi.fn() } }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const requestResetMock = authClient.requestPasswordReset as unknown as Mock;

async function requestReset() : Promise<MountedAuthPage>
{
    const page = await mountAuthPage(ForgotPasswordPage, '/forgot-password', '/forgot-password');
    await fillField(page.wrapper, 'email', 'member@example.com');
    await submit(page.wrapper);

    return page;
}

beforeEach(() =>
{
    vi.clearAllMocks();
    requestResetMock.mockResolvedValue({ error: null });
});

//----------------------------------------------------------------------------------------------------------------------

describe('ForgotPasswordPage', () =>
{
    it('asks for a reset link that comes back to this instance\'s reset page', async () =>
    {
        await requestReset();

        expect(requestResetMock).toHaveBeenCalledWith({
            email: 'member@example.com',
            redirectTo: `${ window.location.origin }/reset-password`,
        });
    });

    // The same answer for any address, so the page cannot be used to find out who has an account.
    it('confirms the request without saying whether the address has an account', async () =>
    {
        const { wrapper } = await requestReset();

        expect(alertText(wrapper)).toContain('If that address has an account');
        expect(wrapper.find('form').exists()).toBe(false);
    });

    it('says why the request failed, in the server\'s words, and keeps the form', async () =>
    {
        requestResetMock.mockResolvedValue({ error: { status: 429, message: 'Too many requests. Try again later.' } });

        const { wrapper } = await requestReset();

        expect(alertText(wrapper)).toBe('Too many requests. Try again later.');
        expect(wrapper.find('form').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
