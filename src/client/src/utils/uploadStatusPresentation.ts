//----------------------------------------------------------------------------------------------------------------------
// Upload Status Presentation
//
// The single source of how an upload item's status reads on screen: per-status label, lucide icon, and Tailwind
// text-colour. The upload panel's rows draw from this one table, so a status looks the same wherever it appears. The
// in-flight statuses share the moving-file glyph in the primary colour; the three terminal states each get their own
// glyph and colour. Purely how a status is displayed -- which statuses are still active is the pipeline's call
// (isActiveStatus), not this table's.
//----------------------------------------------------------------------------------------------------------------------

// Stores
import type { UploadStatus } from '../stores/uploads.ts';

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
