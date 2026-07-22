//----------------------------------------------------------------------------------------------------------------------
// Run With Toast
//
// The one place a drive mutation's failure becomes a toast. A regulation rejection reads as its human-written line, a
// plain API error as the server's message, anything else as a generic retry prompt. runMutation flips an optional
// pending flag around the call and runs an onSuccess only when the action resolves, so a dialog stays open on failure
// and closes on success. Shared by the route component (copy, trash) and the create/rename/move modals so the toasting
// is not written twice.
//----------------------------------------------------------------------------------------------------------------------

import { useToast } from '@nuxt/ui/composables';

// Resource Access
import { ApiError, RegulationApiError } from '../resource-access/apiError.ts';

// Utils
import { regulationMessage } from './formatters/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export function describeApiError(caught : unknown) : string
{
    if(caught instanceof RegulationApiError) { return regulationMessage(caught); }
    if(caught instanceof ApiError) { return caught.message; }

    return 'Please try again.';
}

//----------------------------------------------------------------------------------------------------------------------

export interface PendingFlag { value : boolean }

export interface RunWithToast
{
    runMutation : (action : () => Promise<void>, pending ?: PendingFlag, onSuccess ?: () => void) => Promise<void>;
}

export function useRunWithToast() : RunWithToast
{
    const toast = useToast();

    const runMutation : RunWithToast['runMutation'] = async (action, pending, onSuccess) =>
    {
        if(pending) { pending.value = true; }

        try
        {
            await action();
            onSuccess?.();
        }
        catch(caught)
        {
            toast.add({ title: 'That didn\'t work', description: describeApiError(caught), color: 'error' });
        }
        finally
        {
            if(pending) { pending.value = false; }
        }
    };

    return { runMutation };
}

//----------------------------------------------------------------------------------------------------------------------
