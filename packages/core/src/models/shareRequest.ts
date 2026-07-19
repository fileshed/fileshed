//----------------------------------------------------------------------------------------------------------------------
// Share Request Domain Model
//
// A recipient-initiated ask for access, routed to the target's owner (requirements.md sec 3.5). Modeled as a union on
// status so resolvedAt exists exactly when the request has been resolved: a pending request carries null, a granted or
// declined one carries the resolution time. "Pending with a resolvedAt" and "resolved without one" are unrepresentable.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ShareRole } from './role.ts';

//----------------------------------------------------------------------------------------------------------------------

interface ShareRequestBase
{
    id : string;
    nodeID : string;
    requesterID : string;
    requestedRole : ShareRole;
    createdAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------
// Status Variants
//----------------------------------------------------------------------------------------------------------------------

export interface PendingShareRequest extends ShareRequestBase
{
    status : 'pending';
    resolvedAt : null;
}

export interface ResolvedShareRequest extends ShareRequestBase
{
    status : 'granted' | 'declined';
    resolvedAt : Date;
}

export type ShareRequest = PendingShareRequest | ResolvedShareRequest;

//----------------------------------------------------------------------------------------------------------------------
