//----------------------------------------------------------------------------------------------------------------------
// Upload Status Presentation
//
// Which statuses are still active is the pipeline's call (isActiveStatus), not this table's.
//----------------------------------------------------------------------------------------------------------------------

// Engines
import type { UploadStatus } from '../../engines/uploads/status.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface UploadStatusPresentation
{
    label : string;
    icon : string;
    color : string;
}

const STATUS_PRESENTATION : Readonly<Record<UploadStatus, UploadStatusPresentation>> = {
    queued: { label: 'Waiting', icon: 'i-lucide-file-up', color: 'text-primary' },
    hashing: { label: 'Preparing', icon: 'i-lucide-file-up', color: 'text-primary' },
    checking: { label: 'Preparing', icon: 'i-lucide-file-up', color: 'text-primary' },
    prompt: { label: 'Needs your choice', icon: 'i-lucide-file-up', color: 'text-primary' },
    claiming: { label: 'Uploading', icon: 'i-lucide-file-up', color: 'text-primary' },
    uploading: { label: 'Uploading', icon: 'i-lucide-file-up', color: 'text-primary' },
    proving: { label: 'Verifying', icon: 'i-lucide-file-up', color: 'text-primary' },
    done: { label: 'Done', icon: 'i-lucide-circle-check', color: 'text-success' },
    error: { label: 'Failed', icon: 'i-lucide-circle-alert', color: 'text-error' },
    cancelled: { label: 'Cancelled', icon: 'i-lucide-circle-x', color: 'text-muted' },
};

//----------------------------------------------------------------------------------------------------------------------

export function uploadStatusPresentation(status : UploadStatus) : UploadStatusPresentation
{
    return STATUS_PRESENTATION[status];
}

//----------------------------------------------------------------------------------------------------------------------
