//----------------------------------------------------------------------------------------------------------------------
// Setup Page
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { APIError } from '@client/resource-access/apiError.ts';
import { authClient } from '@client/resource-access/authClient.ts';
import { completeSetup, getInstance } from '@client/resource-access/instance.ts';
import { getMe } from '@client/resource-access/me.ts';

// Support
import { type MountedAuthPage, alertText, fillField, mountAuthPage, submit } from './authPageSupport.ts';
import { instanceFixture, meFixture } from '../support.ts';

// Under test
import SetupPage from '@client/pages/setupPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { signIn: { email: vi.fn() } } }));
vi.mock('@client/resource-access/instance.ts', () => ({ getInstance: vi.fn(), completeSetup: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ getMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const signInEmail = authClient.signIn.email as unknown as Mock;
const getInstanceMock = getInstance as unknown as Mock;
const completeSetupMock = completeSetup as unknown as Mock;
const getMeMock = getMe as unknown as Mock;

async function completeWizard() : Promise<MountedAuthPage>
{
    const page = await mountAuthPage(SetupPage, '/setup', '/setup');
    await fillField(page.wrapper, 'token', '  setup-code-123  ');
    await fillField(page.wrapper, 'name', 'First Admin');
    await fillField(page.wrapper, 'email', 'admin@example.com');
    await fillField(page.wrapper, 'password', 'correct-horse-battery');
    await fillField(page.wrapper, 'confirm', 'correct-horse-battery');
    await submit(page.wrapper);

    return page;
}

beforeEach(() =>
{
    vi.clearAllMocks();
    getInstanceMock.mockResolvedValue(instanceFixture({ needsSetup: true }));
    completeSetupMock.mockResolvedValue({ email: 'admin@example.com' });
    signInEmail.mockResolvedValue({ error: null });
    getMeMock.mockResolvedValue(meFixture({ role: 'admin' }));
});

//----------------------------------------------------------------------------------------------------------------------

describe('SetupPage', () =>
{
    // The code is copied out of a server log, where a stray space at either end is the norm rather than a typo.
    it('creates the first account with the setup code as copied, minus the whitespace around it', async () =>
    {
        await completeWizard();

        expect(completeSetupMock).toHaveBeenCalledWith({
            token: 'setup-code-123',
            name: 'First Admin',
            email: 'admin@example.com',
            password: 'correct-horse-battery',
        });
    });

    it('signs the new admin in and lands them in the admin section', async () =>
    {
        const { router } = await completeWizard();

        expect(signInEmail).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'correct-horse-battery' });
        expect(router.currentRoute.value.path).toBe('/admin');
    });

    it('says why setup was refused, in the server\'s words, and signs nobody in', async () =>
    {
        completeSetupMock.mockRejectedValue(new APIError(403, 'That setup code is not valid.'));

        const { wrapper, router } = await completeWizard();

        expect(alertText(wrapper)).toBe('That setup code is not valid.');
        expect(signInEmail).not.toHaveBeenCalled();
        expect(router.currentRoute.value.path).toBe('/setup');
    });

    it('sends the visitor to sign in once the instance is already set up', async () =>
    {
        getInstanceMock.mockResolvedValue(instanceFixture({ needsSetup: false }));

        const { router } = await mountAuthPage(SetupPage, '/setup', '/setup');

        expect(router.currentRoute.value.path).toBe('/signin');
    });
});

//----------------------------------------------------------------------------------------------------------------------
