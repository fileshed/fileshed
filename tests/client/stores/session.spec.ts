//----------------------------------------------------------------------------------------------------------------------
// Session Store
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
    DEFAULT_EDITOR_GUTTER,
    DEFAULT_EDITOR_THEME,
    DEFAULT_ROOT_LABEL,
    DEFAULT_TIME_FORMAT,
    DEFAULT_VIEW_MODE,
} from '@fileshed/core';

// Resource Access
import { APIError } from '@client/resource-access/apiError.ts';
import { authClient } from '@client/resource-access/authClient.ts';
import { getMe } from '@client/resource-access/me.ts';
import { updatePreferences } from '@client/resource-access/preferences.ts';

// Support
import { meFixture } from '../support.ts';

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

vi.mock('@client/resource-access/me.ts', () => ({ getMe: vi.fn() }));
vi.mock('@client/resource-access/preferences.ts', () => ({ updatePreferences: vi.fn() }));

// The better-auth client and the RA calls are the only mocked seam; casting to Mock frees the tests from better-auth's
// exact response types while still driving resolve/reject and asserting calls.
const signInEmail = authClient.signIn.email as unknown as Mock;
const signUpEmail = authClient.signUp.email as unknown as Mock;
const signOutMock = authClient.signOut as unknown as Mock;
const getMeMock = getMe as unknown as Mock;
const updatePreferencesMock = updatePreferences as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

describe('useSessionStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();

        // The device's own view mode lives in localStorage and outranks the account's, so a value left by one test
        // would decide the next one's answer.
        window.localStorage.clear();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sign in
    //------------------------------------------------------------------------------------------------------------------

    it('populates the current user from /api/me on a successful sign-in', async () =>
    {
        signInEmail.mockResolvedValue({ error: null });
        getMeMock.mockResolvedValue(meFixture({ email: 'member@example.com', role: 'user' }));
        const store = useSessionStore();

        await store.signIn('member@example.com', 'correct-horse');

        expect(store.isAuthenticated).toBe(true);
        expect(store.me?.email).toBe('member@example.com');
        expect(store.isAdmin).toBe(false);
    });

    it('reports the admin role for an admin account', async () =>
    {
        signInEmail.mockResolvedValue({ error: null });
        getMeMock.mockResolvedValue(meFixture({ role: 'admin' }));
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
        expect(getMeMock).not.toHaveBeenCalled();
    });

    it('reports pending only while a sign-in is in flight', async () =>
    {
        let resolveSignIn : (() => void) | undefined;
        signInEmail.mockReturnValue(new Promise((resolve) => { resolveSignIn = () => resolve({ error: null }); }));
        getMeMock.mockResolvedValue(meFixture());
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
        getMeMock.mockResolvedValue(meFixture({ email: 'new@example.com' }));
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
        expect(getMeMock).not.toHaveBeenCalled();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sign out
    //------------------------------------------------------------------------------------------------------------------

    it('clears the current user on sign-out', async () =>
    {
        signInEmail.mockResolvedValue({ error: null });
        getMeMock.mockResolvedValue(meFixture());
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
        getMeMock.mockResolvedValue(meFixture({ role: 'admin' }));
        const store = useSessionStore();

        await store.init();

        expect(store.isAuthenticated).toBe(true);
        expect(store.isAdmin).toBe(true);
        expect(store.initialized).toBe(true);
    });

    it('resolves to signed-out when there is no session (401)', async () =>
    {
        getMeMock.mockRejectedValue(new APIError(401, 'Unauthorized'));
        const store = useSessionStore();

        await store.init();

        expect(store.isAuthenticated).toBe(false);
        expect(store.me).toBeNull();
        expect(store.initialized).toBe(true);
    });

    it('stays signed out when the profile fetch fails unexpectedly', async () =>
    {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getMeMock.mockRejectedValue(new APIError(500, 'Internal Server Error'));
        const store = useSessionStore();

        await store.init();

        expect(store.isAuthenticated).toBe(false);
        consoleError.mockRestore();
    });

    it('restores exactly once under concurrent callers', async () =>
    {
        getMeMock.mockResolvedValue(meFixture());
        const store = useSessionStore();

        await Promise.all([ store.init(), store.init() ]);

        expect(getMeMock).toHaveBeenCalledTimes(1);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Refresh
    //------------------------------------------------------------------------------------------------------------------

    it('adopts the profile a refresh reads', async () =>
    {
        getMeMock.mockResolvedValueOnce(meFixture()).mockResolvedValueOnce(meFixture({ name: 'Renamed' }));
        const store = useSessionStore();
        await store.init();

        await store.refreshProfile();

        expect(store.me?.name).toBe('Renamed');
    });

    it('keeps the profile in hand when a refresh read fails', async () =>
    {
        getMeMock.mockResolvedValueOnce(meFixture({ name: 'Ada' })).mockRejectedValueOnce(new Error('offline'));
        const store = useSessionStore();
        await store.init();

        await expect(store.refreshProfile()).resolves.toBeUndefined();

        expect(store.me?.name).toBe('Ada');
    });

    //------------------------------------------------------------------------------------------------------------------
    // Files-root label
    //------------------------------------------------------------------------------------------------------------------

    it('reports the default files-root label when no preference is set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        const store = useSessionStore();

        await store.init();

        expect(store.rootLabel).toBe(DEFAULT_ROOT_LABEL);
    });

    it('reports the stored files-root label when one is set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: { rootLabel: 'Work' } }));
        const store = useSessionStore();

        await store.init();

        expect(store.rootLabel).toBe('Work');
    });

    it('reports the default files-root label while signed out', () =>
    {
        const store = useSessionStore();

        expect(store.rootLabel).toBe(DEFAULT_ROOT_LABEL);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Time format
    //------------------------------------------------------------------------------------------------------------------

    it('reports the default time format when no preference is set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        const store = useSessionStore();

        await store.init();

        expect(store.timeFormat).toBe(DEFAULT_TIME_FORMAT);
    });

    it('reports the stored time format when one is set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: { timeFormat: '24h' } }));
        const store = useSessionStore();

        await store.init();

        expect(store.timeFormat).toBe('24h');
    });

    //------------------------------------------------------------------------------------------------------------------
    // Save preferences
    //------------------------------------------------------------------------------------------------------------------

    it('adopts the refreshed profile after saving a preferences patch', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { rootLabel: 'Photos' } }));
        const store = useSessionStore();
        await store.init();

        await store.savePreferences({ rootLabel: 'Photos' });

        expect(store.rootLabel).toBe('Photos');
        expect(store.me?.preferences.rootLabel).toBe('Photos');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ rootLabel: 'Photos' });
    });

    //------------------------------------------------------------------------------------------------------------------
    // Editor view preferences
    //------------------------------------------------------------------------------------------------------------------

    it('reports the default editor theme and gutter when none are set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        const store = useSessionStore();

        await store.init();

        expect(store.editorTheme).toBe(DEFAULT_EDITOR_THEME);
        expect(store.editorGutter).toBe(DEFAULT_EDITOR_GUTTER);
    });

    it('reports the stored editor theme and gutter when set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: { editorTheme: 'nord', editorGutter: true } }));
        const store = useSessionStore();

        await store.init();

        expect(store.editorTheme).toBe('nord');
        expect(store.editorGutter).toBe(true);
    });

    it('applies an editor preference in memory at once without hitting the wire', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        const store = useSessionStore();
        await store.init();

        store.applyPreferences({ editorTheme: 'dracula', editorGutter: true });

        expect(store.editorTheme).toBe('dracula');
        expect(store.editorGutter).toBe(true);
        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('ignores an applied editor preference while signed out', () =>
    {
        const store = useSessionStore();

        store.applyPreferences({ editorTheme: 'nord' });

        expect(store.me).toBeNull();
        expect(store.editorTheme).toBe(DEFAULT_EDITOR_THEME);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Drive view mode
    //------------------------------------------------------------------------------------------------------------------

    it('reports the default view mode (grid) when no preference is set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        const store = useSessionStore();

        await store.init();

        expect(store.viewMode).toBe('grid');
        expect(store.viewMode).toBe(DEFAULT_VIEW_MODE);
    });

    it('reports the stored view mode when one is set', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));
        const store = useSessionStore();

        await store.init();

        expect(store.viewMode).toBe('list');
    });

    // The account preference is what a device inherits before it has an opinion; once somebody chooses on a device,
    // that device keeps its choice. Otherwise a phone opens in whatever was last picked on a desktop, which is the
    // whole complaint.
    it('lets this browser outrank the account\'s stored view mode', async () =>
    {
        window.localStorage.setItem('fileshed.drive.deviceViewMode', 'list');
        getMeMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'grid' } }));
        const store = useSessionStore();

        await store.init();

        expect(store.viewMode).toBe('list');
    });

    it('follows the account when this browser has never chosen', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));
        const store = useSessionStore();

        await store.init();

        expect(store.viewMode).toBe('list');
    });

    it('ignores a stored value that is not a view mode', async () =>
    {
        window.localStorage.setItem('fileshed.drive.deviceViewMode', 'mosaic');
        getMeMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));
        const store = useSessionStore();

        await store.init();

        expect(store.viewMode).toBe('list');
    });

    // Binding the browser and updating the account are one gesture: the device keeps what it was told, and the next
    // device to arrive inherits the most recent choice rather than whatever was picked first.
    it('binds this browser and the account together when a view mode is chosen', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'grid' } }));
        const store = useSessionStore();
        await store.init();

        store.chooseViewMode('list');

        expect(store.viewMode).toBe('list');
        expect(window.localStorage.getItem('fileshed.drive.deviceViewMode')).toBe('list');
        expect(store.me?.preferences.viewMode).toBe('list');
        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('applies a view-mode preference in memory at once without hitting the wire', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        const store = useSessionStore();
        await store.init();

        store.applyPreferences({ viewMode: 'list' });

        expect(store.viewMode).toBe('list');
        expect(updatePreferencesMock).not.toHaveBeenCalled();
    });

    it('adopts the refreshed profile after saving a view-mode preference patch', async () =>
    {
        getMeMock.mockResolvedValue(meFixture({ preferences: {} }));
        updatePreferencesMock.mockResolvedValue(meFixture({ preferences: { viewMode: 'list' } }));
        const store = useSessionStore();
        await store.init();

        await store.savePreferences({ viewMode: 'list' });

        expect(store.viewMode).toBe('list');
        expect(updatePreferencesMock).toHaveBeenCalledWith({ viewMode: 'list' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
