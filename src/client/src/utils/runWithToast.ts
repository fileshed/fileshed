//----------------------------------------------------------------------------------------------------------------------
// Run With Toast
//
// The one place a drive mutation's failure becomes a toast. A regulation rejection reads as its human-written line, a
// size refusal as the server's message plus the limit it broke, any other API error as the server's message, and
// anything else as a generic retry prompt. runMutation flips an optional pending flag around the call and runs an
// onSuccess only when the action resolves, so a dialog stays open on failure and closes on success. Shared by the
// route component (copy, trash) and the create/rename/move modals so the toasting is not written twice.
//----------------------------------------------------------------------------------------------------------------------

import { useToast } from '@nuxt/ui/composables';

// Resource Access
import { ApiError, RegulationApiError } from '../resource-access/apiError.ts';

// Utils
import { formatBytes, regulationMessage } from './formatters/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// The cap a rejected upload broke, off the 413 body the server sends it in, or null when there is none to read -- a
// proxy in front of the instance answers its own 413, and whatever body it writes is nothing like ours.
function payloadLimitOf(error : ApiError) : number | null
{
    if(error.status !== 413 || typeof error.body !== 'object' || error.body === null) { return null; }

    const { maxBytes } = error.body as { maxBytes : unknown };

    return typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : null;
}

export function describeApiError(caught : unknown) : string
{
    if(caught instanceof RegulationApiError) { return regulationMessage(caught); }

    if(caught instanceof ApiError)
    {
        // "Too large" says nothing without the size it was measured against, and the person reading it just picked
        // the file -- so the limit goes on the end of the server's own sentence, in units a human reads.
        const maxBytes = payloadLimitOf(caught);
        if(maxBytes === null) { return caught.message; }

        return `${ caught.message.replace(/\.$/, '') } (${ formatBytes(maxBytes) }).`;
    }

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
