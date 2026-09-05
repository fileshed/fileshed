//----------------------------------------------------------------------------------------------------------------------
// Session Store
//
// The current user's session: the /api/me profile (identity, role, live quota) plus the sign-in / sign-up / sign-out
// actions that drive better-auth. Identity and quota come from our own /api/me rather than better-auth's client
// session -- the auth client's inferred user carries neither the app role nor the quota, and /api/me is the app's
// authoritative profile. A valid cookie yields the profile; a missing or expired one 401s to signed-out.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    type ColorMode,
    DEFAULT_ALLOW_REMOTE_MEDIA,
    DEFAULT_EDITOR_GUTTER,
    DEFAULT_EDITOR_THEME,
    DEFAULT_ROOT_LABEL,
    DEFAULT_TIME_FORMAT,
    DEFAULT_TRASH_PURGE_DAYS,
    DEFAULT_VIEW_MODE,
    type MeResponse,
    type UpdatePreferencesRequest,
    type ViewMode,
} from '@fileshed/core';

// Resource Access
import { ApiError } from '../resource-access/apiError.ts';
import { authClient } from '../resource-access/authClient.ts';
import { deleteAvatar, uploadAvatar } from '../resource-access/avatar.ts';
import { fetchMe } from '../resource-access/me.ts';
import { updatePreferences } from '../resource-access/preferences.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useSessionStore = defineStore('session', () =>
{
    const me = ref<MeResponse | null>(null);
    const pending = ref(false);
    const initialized = ref(false);

    // Restoration is awaited by the router guard on first navigation; the in-flight promise is shared so concurrent
    // callers restore exactly once.
    let restoring : Promise<void> | null = null;

    const isAuthenticated = computed(() => me.value !== null);
    const isAdmin = computed(() => me.value?.role === 'admin');

    // The files-root name, with the default standing in until the user sets one. The single place that fallback lives,
    // so every surface that renders the root -- sidebar, breadcrumb, move picker -- reads it here.
    const rootLabel = computed(() => me.value?.preferences.rootLabel ?? DEFAULT_ROOT_LABEL);

    // The clock style for node timestamps, defaulting until the user picks one. The single place that fallback lives;
    // date-rendering components read it here and pass it to the pure formatter.
    const timeFormat = computed(() => me.value?.preferences.timeFormat ?? DEFAULT_TIME_FORMAT);

    // The editor colorscheme id and whether its gutter shows, each defaulting until the user picks. The single place
    // those fallbacks live; the file editor reads them here. An unknown stored theme id is the client registry's
    // problem to resolve, not this getter's.
    const editorTheme = computed(() => me.value?.preferences.editorTheme ?? DEFAULT_EDITOR_THEME);
    const editorGutter = computed(() => me.value?.preferences.editorGutter ?? DEFAULT_EDITOR_GUTTER);

    // The drive's grid-vs-list choice, defaulting until the user picks one. The single place that fallback lives; the
    // drive page reads it here.
    const viewMode = computed(() => me.value?.preferences.viewMode ?? DEFAULT_VIEW_MODE);

    // Whether a playlist entry pointing off this instance may be played. The media player reads it here; a playlist is
    // something one user hands another, and this is the reader deciding whether their own browser answers it.
    const allowRemoteMedia = computed(
        () => me.value?.preferences.allowRemoteMedia ?? DEFAULT_ALLOW_REMOTE_MEDIA
    );

    // The user's light/dark/system choice, deliberately WITHOUT a fallback: undefined means "never chose", which
    // the color-mode resolver treats differently from any choice (the instance default applies instead).
    const colorMode = computed(() => me.value?.preferences.colorMode);

    // The deployment's effective trash retention, defaulting only until the profile loads -- the server always sends
    // the configured value, so copy built on this never shows a shipped default an operator has overridden.
    const trashRetentionDays = computed(() => me.value?.limits.trashRetentionDays ?? DEFAULT_TRASH_PURGE_DAYS);

    async function initialize() : Promise<void>
    {
        if(initialized.value) { return; }
        if(restoring) { return restoring; }

        restoring = (async () =>
        {
            try
            {
                me.value = await fetchMe();
            }
            catch(error)
            {
                me.value = null;

                // A 401 is the ordinary signed-out case. Anything else is unexpected -- surface it, but still resolve
                // to signed-out so boot proceeds and the guard sends the visitor to sign in.
                if(!(error instanceof ApiError) || error.status !== 401)
                {
                    console.error('Session restore failed', error);
                }
            }
            finally
            {
                initialized.value = true;
                restoring = null;
            }
        })();

        return restoring;
    }

    async function signIn(email : string, password : string) : Promise<void>
    {
        pending.value = true;
        try
        {
            const { error } = await authClient.signIn.email({ email, password });
            if(error) { throw new Error(error.message ?? 'Unable to sign in. Check your email and password.'); }

            me.value = await fetchMe();
            initialized.value = true;
        }
        finally { pending.value = false; }
    }

    async function signUp(name : string, email : string, password : string) : Promise<void>
    {
        pending.value = true;
        try
        {
            const { error } = await authClient.signUp.email({ name, email, password });
            if(error) { throw new Error(error.message ?? 'Unable to create your account.'); }

            me.value = await fetchMe();
            initialized.value = true;
        }
        finally { pending.value = false; }
    }

    async function signOut() : Promise<void>
    {
        pending.value = true;
        try
        {
            await authClient.signOut();
            me.value = null;
        }
        finally { pending.value = false; }
    }

    // Re-adopt the profile after something outside this store changed what it reports -- an upload or permanent
    // delete moving the quota gauge. Failures propagate to the caller, who usually fires-and-forgets this.
    async function refreshProfile() : Promise<void>
    {
        me.value = await fetchMe();
    }

    // Drop the signed-in state without a sign-out round trip -- for when the server already killed the session
    // (revocation, ban) and calling the sign-out endpoint would just 401 again.
    function clearSession() : void
    {
        me.value = null;
    }

    // Save a preferences patch and adopt the refreshed profile the server returns, so every surface reading `me`
    // (sidebar root label, quota) reacts at once. Failures propagate to the caller to toast.
    async function savePreferences(patch : UpdatePreferencesRequest) : Promise<void>
    {
        me.value = await updatePreferences(patch);
    }

    // Change the display name through better-auth's self-service updateUser, then adopt the refreshed profile so every
    // surface reading `me` (the header menu, the profile card) re-labels at once. Failures propagate to the caller to
    // toast.
    async function updateName(name : string) : Promise<void>
    {
        const { error } = await authClient.updateUser({ name });
        if(error) { throw new Error(error.message ?? 'Unable to update your name.'); }

        me.value = await fetchMe();
    }

    // Change the sign-in password through better-auth's self-service changePassword. Nothing in /api/me depends on the
    // password, so there is no profile to re-adopt; revokeOtherSessions signs every other device out. Failures
    // propagate to the caller to toast.
    async function changePassword(
        currentPassword : string,
        newPassword : string,
        revokeOtherSessions : boolean
    ) : Promise<void>
    {
        const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions });
        if(error) { throw new Error(error.message ?? 'Unable to change your password.'); }
    }

    // Upload a new avatar and adopt the refreshed profile the server returns, so the new image URL propagates to the
    // header and the profile card at once. Failures propagate to the caller to toast.
    async function saveAvatar(file : File) : Promise<void>
    {
        me.value = await uploadAvatar(file);
    }

    // Remove the avatar, then refetch the profile (the DELETE answers 204, not the refreshed shape) so the image URL
    // clears everywhere. Failures propagate to the caller to toast.
    async function removeAvatar() : Promise<void>
    {
        await deleteAvatar();
        me.value = await fetchMe();
    }

    // Merge a view preference into the in-memory profile at once, without a write, so the surface reflects a pick the
    // instant it happens. A savePreferences call follows to persist the settled value and reconcile against the
    // server's echo.
    function applyPreferences(
        patch : { editorTheme ?: string; editorGutter ?: boolean; viewMode ?: ViewMode; colorMode ?: ColorMode }
    ) : void
    {
        if(me.value === null) { return; }
        me.value = { ...me.value, preferences: { ...me.value.preferences, ...patch } };
    }

    return {
        me,
        pending,
        initialized,
        isAuthenticated,
        isAdmin,
        rootLabel,
        timeFormat,
        editorTheme,
        editorGutter,
        viewMode,
        colorMode,
        allowRemoteMedia,
        trashRetentionDays,
        initialize,
        signIn,
        signUp,
        signOut,
        clearSession,
        refreshProfile,
        savePreferences,
        applyPreferences,
        updateName,
        changePassword,
        saveAvatar,
        removeAvatar,
    };
});

//----------------------------------------------------------------------------------------------------------------------
