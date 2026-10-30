//----------------------------------------------------------------------------------------------------------------------
// Share Request Domain Model
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ShareRole } from './role.ts';

//----------------------------------------------------------------------------------------------------------------------

export const resolvedShareRequestStatuses = [ 'granted', 'declined' ] as const;
export type ResolvedShareRequestStatus = typeof resolvedShareRequestStatuses[number];

export const shareRequestStatuses = [ 'pending', ...resolvedShareRequestStatuses ] as const;
export type ShareRequestStatus = typeof shareRequestStatuses[number];

//----------------------------------------------------------------------------------------------------------------------

interface ShareRequestBase
{
    id : string;
    nodeID : string;
    requesterID : string;
    requestedRole : ShareRole;
    message : string | null;
    created : Date;
}

//----------------------------------------------------------------------------------------------------------------------
// Status Variants
//----------------------------------------------------------------------------------------------------------------------

export interface PendingShareRequest extends ShareRequestBase
{
    status : 'pending';
    resolved : null;
}

export interface ResolvedShareRequest extends ShareRequestBase
{
    status : ResolvedShareRequestStatus;
    resolved : Date;
}

export type ShareRequest = PendingShareRequest | ResolvedShareRequest;

//----------------------------------------------------------------------------------------------------------------------
