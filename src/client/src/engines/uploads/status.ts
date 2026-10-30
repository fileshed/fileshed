//----------------------------------------------------------------------------------------------------------------------
// Upload Status
//----------------------------------------------------------------------------------------------------------------------

export type UploadStatus
    = 'queued' | 'hashing' | 'checking' | 'prompt' | 'claiming'
    | 'uploading' | 'proving' | 'done' | 'error' | 'cancelled';

const TERMINAL : ReadonlySet<UploadStatus> = new Set([ 'done', 'error', 'cancelled' ]);

// An item still moving through the pipeline: not yet in a terminal state. Such an item is cancellable and shows a
// progress bar; the row reads this rather than re-listing the status set.
export function isActiveStatus(status : UploadStatus) : boolean
{
    return !TERMINAL.has(status);
}

//----------------------------------------------------------------------------------------------------------------------
