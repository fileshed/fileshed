//----------------------------------------------------------------------------------------------------------------------
// Reset Password Page
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';

// Support
import { type MountedAuthPage, alertText, fillField, mountAuthPage, submit } from './authPageSupport.ts';

// Under test
import ResetPasswordPage from '@client/pages/resetPasswordPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { resetPassword: vi.fn() } }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const resetPasswordMock = authClient.resetPassword as unknown as Mock;

function openReset(location : string) : Promise<MountedAuthPage>
{
    return mountAuthPage(ResetPasswordPage, '/reset-password', location);
}

async function chooseNewPassword(location : string) : Promise<MountedAuthPage>
{
    const page = await openReset(location);
    await fillField(page.wrapper, 'password', 'new-correct-horse');
    await fillField(page.wrapper, 'confirm', 'new-correct-horse');
    await submit(page.wrapper);

    return page;
}

beforeEach(() =>
{
    vi.clearAllMocks();
    resetPasswordMock.mockResolvedValue({ error: null });
});

//----------------------------------------------------------------------------------------------------------------------

describe('ResetPasswordPage', () =>
{
    it('sets the new password against the token the link carried', async () =>
    {
        await chooseNewPassword('/reset-password?token=tok-123');

        expect(resetPasswordMock).toHaveBeenCalledWith({ newPassword: 'new-correct-horse', token: 'tok-123' });
    });

    it('confirms the change and points the way to sign in', async () =>
    {
        const { wrapper } = await chooseNewPassword('/reset-password?token=tok-123');

        expect(alertText(wrapper)).toContain('Your password is changed');
        expect(wrapper.text()).toContain('Go to sign in');
    });

    it('says why the reset failed, in the server\'s words, and keeps the form', async () =>
    {
        resetPasswordMock.mockResolvedValue({ error: { status: 400, message: 'Invalid token' } });

        const { wrapper } = await chooseNewPassword('/reset-password?token=tok-123');

        expect(alertText(wrapper)).toBe('Invalid token');
        expect(wrapper.find('form').exists()).toBe(true);
    });

    it('offers a fresh link instead of a form when the link carries no token', async () =>
    {
        const { wrapper } = await openReset('/reset-password');

        expect(wrapper.find('form').exists()).toBe(false);
        expect(alertText(wrapper)).toContain('invalid or has expired');
        expect(wrapper.text()).toContain('Request a new link');
    });

    // better-auth sends an expired or used link back here with ?error= rather than a token.
    it('offers a fresh link when the server sent the visitor back with an error', async () =>
    {
        const { wrapper } = await openReset('/reset-password?error=INVALID_TOKEN');

        expect(wrapper.find('form').exists()).toBe(false);
        expect(alertText(wrapper)).toContain('invalid or has expired');
    });
});

//----------------------------------------------------------------------------------------------------------------------
