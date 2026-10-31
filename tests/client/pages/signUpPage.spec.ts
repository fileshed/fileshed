//----------------------------------------------------------------------------------------------------------------------
// Sign Up Page
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';
import { getInstance } from '@client/resource-access/instance.ts';
import { getMe } from '@client/resource-access/me.ts';

// Support
import { type MountedAuthPage, alertText, fillField, mountAuthPage, submit } from './authPageSupport.ts';
import { instanceFixture, meFixture } from '../support.ts';

// Under test
import SignUpPage from '@client/pages/signUpPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({ authClient: { signUp: { email: vi.fn() } } }));
vi.mock('@client/resource-access/instance.ts', () => ({ getInstance: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ getMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const signUpEmail = authClient.signUp.email as unknown as Mock;
const getInstanceMock = getInstance as unknown as Mock;
const getMeMock = getMe as unknown as Mock;

async function signUp() : Promise<MountedAuthPage>
{
    const page = await mountAuthPage(SignUpPage, '/signup', '/signup');
    await fillField(page.wrapper, 'name', 'New Member');
    await fillField(page.wrapper, 'email', 'new@example.com');
    await fillField(page.wrapper, 'password', 'correct-horse-battery');
    await submit(page.wrapper);

    return page;
}

beforeEach(() =>
{
    vi.clearAllMocks();
    getInstanceMock.mockResolvedValue(instanceFixture());
    signUpEmail.mockResolvedValue({ error: null });
    getMeMock.mockResolvedValue(meFixture({ email: 'new@example.com' }));
});

//----------------------------------------------------------------------------------------------------------------------

describe('SignUpPage', () =>
{
    it('creates the account and lands the new member in My Files', async () =>
    {
        const { router } = await signUp();

        expect(signUpEmail).toHaveBeenCalledWith({
            name: 'New Member',
            email: 'new@example.com',
            password: 'correct-horse-battery',
        });
        expect(router.currentRoute.value.path).toBe('/');
    });

    it('says why the account was refused, in the server\'s words, and stays put', async () =>
    {
        signUpEmail.mockResolvedValue({ error: { status: 422, message: 'User already exists' } });

        const { wrapper, router } = await signUp();

        expect(alertText(wrapper)).toBe('User already exists');
        expect(router.currentRoute.value.path).toBe('/signup');
    });

    it('sends the visitor to sign in on an instance that takes no new accounts', async () =>
    {
        getInstanceMock.mockResolvedValue(instanceFixture({ signUpEnabled: false }));

        const { router } = await mountAuthPage(SignUpPage, '/signup', '/signup');

        expect(router.currentRoute.value.path).toBe('/signin');
    });
});

//----------------------------------------------------------------------------------------------------------------------
