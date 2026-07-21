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

import type { MeResponse } from '@fileshed/core';

// Resource Access
import { ApiError } from '../resource-access/apiError.ts';
import { authClient } from '../resource-access/authClient.ts';
import { fetchMe } from '../resource-access/me.ts';

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

    return { me, pending, initialized, isAuthenticated, isAdmin, initialize, signIn, signUp, signOut };
});

//----------------------------------------------------------------------------------------------------------------------
