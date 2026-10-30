//----------------------------------------------------------------------------------------------------------------------
// Sign In Page
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { authClient } from '@client/resource-access/authClient.ts';
import { fetchInstance } from '@client/resource-access/instance.ts';
import { fetchMe } from '@client/resource-access/me.ts';

// Support
import { type MountedAuthPage, alertText, fillField, mountAuthPage, submit } from './authPageSupport.ts';
import { instanceFixture, meFixture } from '../support.ts';

// Under test
import SignInPage from '@client/pages/signInPage.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({
    authClient: { signIn: { email: vi.fn(), social: vi.fn() } },
}));
vi.mock('@client/resource-access/instance.ts', () => ({ fetchInstance: vi.fn() }));
vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const signInEmail = authClient.signIn.email as unknown as Mock;
const signInSocial = authClient.signIn.social as unknown as Mock;
const fetchInstanceMock = fetchInstance as unknown as Mock;
const fetchMeMock = fetchMe as unknown as Mock;

function openSignIn(location = '/signin') : Promise<MountedAuthPage>
{
    return mountAuthPage(SignInPage, '/signin', location);
}

async function signIn(location : string) : Promise<MountedAuthPage>
{
    const page = await openSignIn(location);
    await fillField(page.wrapper, 'email', 'member@example.com');
    await fillField(page.wrapper, 'password', 'correct-horse');
    await submit(page.wrapper);

    return page;
}

beforeEach(() =>
{
    vi.clearAllMocks();
    fetchInstanceMock.mockResolvedValue(instanceFixture());
    signInEmail.mockResolvedValue({ error: null });
    signInSocial.mockResolvedValue({ error: null });
    fetchMeMock.mockResolvedValue(meFixture());
});

//----------------------------------------------------------------------------------------------------------------------

describe('SignInPage', () =>
{
    it('signs in with what the visitor typed', async () =>
    {
        await signIn('/signin');

        expect(signInEmail).toHaveBeenCalledWith({ email: 'member@example.com', password: 'correct-horse' });
    });

    it('lands a signed-in visitor on the page that sent them here', async () =>
    {
        const { router } = await signIn('/signin?redirect=/trash');

        expect(router.currentRoute.value.path).toBe('/trash');
    });

    it('lands on My Files when there is no page to return to', async () =>
    {
        const { router } = await signIn('/signin');

        expect(router.currentRoute.value.path).toBe('/');
    });

    // A crafted link must not turn a fresh sign-in into a bounce to somebody else's site.
    it('lands on My Files rather than follow a redirect off this site', async () =>
    {
        for(const redirect of [ 'https://evil.example/x', '//evil.example/x', '/\\evil.example/x' ])
        {
            // eslint-disable-next-line no-await-in-loop -- each case mounts its own page and router
            const { router } = await signIn(`/signin?redirect=${ encodeURIComponent(redirect) }`);

            expect(router.currentRoute.value.fullPath).toBe('/');
        }
    });

    it('says why the sign-in failed, in the server\'s words, and stays put', async () =>
    {
        signInEmail.mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } });

        const { wrapper, router } = await signIn('/signin?redirect=/trash');

        expect(alertText(wrapper)).toBe('Invalid email or password');
        expect(router.currentRoute.value.path).toBe('/signin');
    });

    it('sends a fresh instance to the first-run wizard', async () =>
    {
        fetchInstanceMock.mockResolvedValue(instanceFixture({ needsSetup: true }));

        const { router } = await openSignIn();

        expect(router.currentRoute.value.path).toBe('/setup');
    });

    it('offers a password reset only when the instance can send mail', async () =>
    {
        const withoutMail = await openSignIn();
        expect(withoutMail.wrapper.text()).not.toContain('Forgot password?');

        fetchInstanceMock.mockResolvedValue(instanceFixture({ emailEnabled: true }));
        const withMail = await openSignIn();
        expect(withMail.wrapper.text()).toContain('Forgot password?');
    });

    it('offers sign-up only when the instance takes new accounts', async () =>
    {
        fetchInstanceMock.mockResolvedValue(instanceFixture({ signUpEnabled: false }));

        const { wrapper } = await openSignIn();

        expect(wrapper.text()).not.toContain('Sign up');
    });

    it('sends a provider sign-in back to the page that sent the visitor here', async () =>
    {
        fetchInstanceMock.mockResolvedValue(instanceFixture({ providers: [ 'github' ] }));
        const { wrapper } = await openSignIn('/signin?redirect=/trash');

        await wrapper.get('[data-label="Continue with GitHub"]').trigger('click');

        expect(signInSocial).toHaveBeenCalledWith({
            provider: 'github',
            callbackURL: `${ window.location.origin }/trash`,
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SignInPage arrival notice', () =>
{
    it('tells a visitor whose session ended elsewhere what happened', async () =>
    {
        const { wrapper } = await openSignIn('/signin?reason=signed-out');

        expect(alertText(wrapper)).toContain('Your session ended');
    });

    it('confirms that signing out everywhere worked', async () =>
    {
        const { wrapper } = await openSignIn('/signin?reason=revoked');

        expect(alertText(wrapper)).toContain('every access token was revoked');
        expect(wrapper.get('[role="alert"]').attributes('data-color')).toBe('success');
    });

    it('points an account scheduled for deletion at signing in to see or cancel it', async () =>
    {
        const { wrapper } = await openSignIn('/signin?reason=deletion-requested');

        expect(alertText(wrapper)).toContain('scheduled for deletion');
    });

    it('shows no notice for an ordinary visit', async () =>
    {
        const { wrapper } = await openSignIn();

        expect(alertText(wrapper)).toBeNull();
    });

    it('gives way to the failure once a sign-in fails', async () =>
    {
        signInEmail.mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } });

        const { wrapper } = await signIn('/signin?reason=signed-out');

        expect(wrapper.findAll('[role="alert"]')).toHaveLength(1);
        expect(alertText(wrapper)).toBe('Invalid email or password');
    });
});

//----------------------------------------------------------------------------------------------------------------------
