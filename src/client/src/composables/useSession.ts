//----------------------------------------------------------------------------------------------------------------------
// Session Composable
//
// A thin reactive view of the current session for components: the raw better-auth session ref, plus the derived user
// and a boolean for the common "signed in?" branch.
//----------------------------------------------------------------------------------------------------------------------

import { type ComputedRef, computed } from 'vue';

// Resource Access
import { authClient } from '../resource-access/authClient.ts';

//----------------------------------------------------------------------------------------------------------------------

// useSession is overloaded: called with a fetcher it returns a Promise (server prefetch); called with no args it
// returns the reactive ref the browser SPA uses. ReturnType would pick the last (Promise) overload, so the no-arg
// signature is matched explicitly.
type SessionRef = typeof authClient.useSession extends { () : infer R; (useFetch : never) : unknown } ? R : never;
type SessionUser = NonNullable<SessionRef['value']['data']>['user'];

export function useSession() : {
    session : SessionRef;
    user : ComputedRef<SessionUser | null>;
    isAuthenticated : ComputedRef<boolean>;
}
{
    const session = authClient.useSession();

    const user = computed(() => session.value.data?.user ?? null);
    const isAuthenticated = computed(() => user.value !== null);

    return { session, user, isAuthenticated };
}

//----------------------------------------------------------------------------------------------------------------------
