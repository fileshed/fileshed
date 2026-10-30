//----------------------------------------------------------------------------------------------------------------------
// Run With Toast
//
// runMutation runs onSuccess only when the action resolves, so a dialog stays open on failure and closes on success.
//----------------------------------------------------------------------------------------------------------------------

import { useToast } from '@nuxt/ui/composables';

// Resource Access
import { APIError, PayloadTooLargeAPIError, RegulationAPIError } from '../resource-access/apiError.ts';

// Utils
import { formatBytes, regulationMessage } from './formatters/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export function describeAPIError(caught : unknown) : string
{
    if(caught instanceof RegulationAPIError) { return regulationMessage(caught); }

    // "Too large" says nothing without the size it was measured against, and the person reading it just picked the
    // file -- so the limit goes on the end of the server's own sentence, in units a human reads.
    if(caught instanceof PayloadTooLargeAPIError && caught.maxBytes !== null)
    {
        return `${ caught.message.replace(/\.$/, '') } (${ formatBytes(caught.maxBytes) }).`;
    }

    if(caught instanceof APIError) { return caught.message; }

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
            toast.add({ title: 'That didn\'t work', description: describeAPIError(caught), color: 'error' });
        }
        finally
        {
            if(pending) { pending.value = false; }
        }
    };

    return { runMutation };
}

//----------------------------------------------------------------------------------------------------------------------
