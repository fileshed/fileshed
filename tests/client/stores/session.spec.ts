//----------------------------------------------------------------------------------------------------------------------
// Session Store
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { authClient } from '@client/resource-access/authClient.ts';
import { fetchMe } from '@client/resource-access/me.ts';

// Under test
import { useSessionStore } from '@client/stores/session.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/authClient.ts', () => ({
    authClient: {
        signIn: { email: vi.fn() },
        signUp: { email: vi.fn() },
        signOut: vi.fn(),
    },
}));

vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));

// The better-auth client and fetchMe are the only mocked seam; casting to Mock frees the tests from better-auth's
// exact response types while still driving resolve/reject and asserting calls.
const signInEmail = authClient.signIn.email as unknown as Mock;
const signUpEmail = authClient.signUp.email as unknown as Mock;
const signOutMock = authClient.signOut as unknown as Mock;
const fetchMeMock = fetchMe as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function meFixture(overrides : Partial<MeResponse> = {}) : MeResponse
{
    return {
        id: 'user_1',
        email: 'member@example.com',
        role: 'user',
        quota: { used: 0, limit: null },
        createdAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('useSessionStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sign in
    //------------------------------------------------------------------------------------------------------------------

    it('populates the current user from /api/me on a successful sign-in', async () =>
    {
        signInEmail.mockResolvedValue({ error: null });
        fetchMeMock.mockResolvedValue(meFixture({ email: 'member@example.com', role: 'user' }));
        const store = useSessionStore();

        await store.signIn('member@example.com', 'correct-horse');

        expect(store.isAuthenticated).toBe(true);
        expect(store.me?.email).toBe('member@example.com');
        expect(store.isAdmin).toBe(false);
    });

    it('reports the admin role for an admin account', async () =>
    {
        signInEmail.mockResolvedValue({ error: null });
        fetchMeMock.mockResolvedValue(meFixture({ role: 'admin' }));
        const store = useSessionStore();

        await store.signIn('admin@example.com', 'correct-horse');

        expect(store.isAdmin).toBe(true);
    });

    it('leaves the session signed out and surfaces the message when sign-in fails', async () =>
    {
        signInEmail.mockResolvedValue({ error: { status: 401, message: 'Invalid email or password' } });
        const store = useSessionStore();

        await expect(store.signIn('member@example.com', 'wrong')).rejects.toThrow('Invalid email or password');

        expect(store.isAuthenticated).toBe(false);
        expect(store.me).toBeNull();
        expect(fetchMeMock).not.toHaveBeenCalled();
    });

    it('reports pending only while a sign-in is in flight', async () =>
    {
        let resolveSignIn : (() => void) | undefined;
        signInEmail.mockReturnValue(new Promise((resolve) => { resolveSignIn = () => resolve({ error: null }); }));
        fetchMeMock.mockResolvedValue(meFixture());
        const store = useSessionStore();

        const inFlight = store.signIn('member@example.com', 'correct-horse');
        expect(store.pending).toBe(true);

        resolveSignIn?.();
        await inFlight;

        expect(store.pending).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sign up
    //------------------------------------------------------------------------------------------------------------------

    it('populates the current user on a successful sign-up', async () =>
    {
        signUpEmail.mockResolvedValue({ error: null });
        fetchMeMock.mockResolvedValue(meFixture({ email: 'new@example.com' }));
        const store = useSessionStore();

        await store.signUp('New Member', 'new@example.com', 'correct-horse');

        expect(store.isAuthenticated).toBe(true);
        expect(store.me?.email).toBe('new@example.com');
    });

    it('leaves the session signed out and surfaces the message when sign-up is rejected', async () =>
    {
        signUpEmail.mockResolvedValue({ error: { status: 422, message: 'User already exists' } });
        const store = useSessionStore();

        await expect(store.signUp('Dup', 'dup@example.com', 'correct-horse')).rejects.toThrow('User already exists');

        expect(store.isAuthenticated).toBe(false);
        expect(fetchMeMock).not.toHaveBeenCalled();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sign out
    //------------------------------------------------------------------------------------------------------------------

    it('clears the current user on sign-out', async () =>
    {
        signInEmail.mockResolvedValue({ error: null });
        fetchMeMock.mockResolvedValue(meFixture());
        signOutMock.mockResolvedValue(undefined);
        const store = useSessionStore();
        await store.signIn('member@example.com', 'correct-horse');
        expect(store.isAuthenticated).toBe(true);

        await store.signOut();

        expect(store.isAuthenticated).toBe(false);
        expect(store.me).toBeNull();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Restore
    //------------------------------------------------------------------------------------------------------------------

    it('restores the profile from a valid session cookie', async () =>
    {
        fetchMeMock.mockResolvedValue(meFixture({ role: 'admin' }));
        const store = useSessionStore();

        await store.initialize();

        expect(store.isAuthenticated).toBe(true);
        expect(store.isAdmin).toBe(true);
        expect(store.initialized).toBe(true);
    });

    it('resolves to signed-out when there is no session (401)', async () =>
    {
        fetchMeMock.mockRejectedValue(new ApiError(401, 'Unauthorized'));
        const store = useSessionStore();

        await store.initialize();

        expect(store.isAuthenticated).toBe(false);
        expect(store.me).toBeNull();
        expect(store.initialized).toBe(true);
    });

    it('stays signed out when the profile fetch fails unexpectedly', async () =>
    {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        fetchMeMock.mockRejectedValue(new ApiError(500, 'Internal Server Error'));
        const store = useSessionStore();

        await store.initialize();

        expect(store.isAuthenticated).toBe(false);
        consoleError.mockRestore();
    });

    it('restores exactly once under concurrent callers', async () =>
    {
        fetchMeMock.mockResolvedValue(meFixture());
        const store = useSessionStore();

        await Promise.all([ store.initialize(), store.initialize() ]);

        expect(fetchMeMock).toHaveBeenCalledTimes(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
