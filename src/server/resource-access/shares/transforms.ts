//----------------------------------------------------------------------------------------------------------------------
// Share Row <-> Domain Transforms
//
// The boundary between the `share` / `share_request` table rows (snake_case, stored timestamps) and the canonical
// domain types of @fileshed/core. shareFromRow / shareRequestFromRow read; the insert builders write ISO-string
// timestamps, which both dialects accept (see database.ts).
//
// A share request is a discriminated union on status where resolvedAt exists exactly when the request is resolved. The
// paired CHECK of migration 001 makes any other pairing unstorable, so a resolved row with a null resolved_at is store
// corruption, surfaced as a typed error rather than silently coerced to the epoch.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- insert builders name snake_case DB columns (house convention for Kysely inserts) */

import type { Insertable, Selectable } from 'kysely';

// Models
import type { PendingShareRequest, Share, ShareRequest } from '@fileshed/core';

// Resource Access
import type { ShareRequestTable, ShareTable } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

// A stored timestamp reads back as a Date (Postgres) or an ISO string (SQLite); new Date normalizes both (database.ts).
function toDate(value : Date | string) : Date
{
    return new Date(value);
}

//----------------------------------------------------------------------------------------------------------------------
// Share
//----------------------------------------------------------------------------------------------------------------------

export function shareFromRow(row : Selectable<ShareTable>) : Share
{
    return {
        id: row.id,
        nodeID: row.node_id,
        granteeUserID: row.grantee_user_id,
        role: row.role,
        createdBy: row.created_by,
        createdAt: toDate(row.created_at),
    };
}

export function rowFromShare(share : Share) : Insertable<ShareTable>
{
    return {
        id: share.id,
        node_id: share.nodeID,
        grantee_user_id: share.granteeUserID,
        role: share.role,
        created_by: share.createdBy,
        created_at: share.createdAt.toISOString(),
    };
}

//----------------------------------------------------------------------------------------------------------------------
// Share request
//----------------------------------------------------------------------------------------------------------------------

export function shareRequestFromRow(row : Selectable<ShareRequestTable>) : ShareRequest
{
    const base = {
        id: row.id,
        nodeID: row.node_id,
        requesterID: row.requester_id,
        requestedRole: row.requested_role,
        message: row.message,
        createdAt: toDate(row.created_at),
    };

    if(row.status === 'pending')
    {
        return { ...base, status: 'pending', resolvedAt: null };
    }

    // The paired CHECK makes this unreachable from a well-formed store; a resolved row without a resolution means the
    // constraint was bypassed out from under us, so we refuse to fabricate an epoch resolvedAt.
    if(row.resolved_at === null)
    {
        throw new Error(`share_request ${ row.id }: a ${ row.status } request must carry a resolved_at`);
    }

    return { ...base, status: row.status, resolvedAt: toDate(row.resolved_at) };
}

// Only a pending request is ever inserted -- resolution is an update, never an insert, so the row always lands with
// status 'pending' and a null resolved_at.
export function rowFromPendingShareRequest(request : PendingShareRequest) : Insertable<ShareRequestTable>
{
    return {
        id: request.id,
        node_id: request.nodeID,
        requester_id: request.requesterID,
        requested_role: request.requestedRole,
        message: request.message,
        status: 'pending',
        created_at: request.createdAt.toISOString(),
        resolved_at: null,
    };
}

//----------------------------------------------------------------------------------------------------------------------
