//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Row Transforms
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- row builders name snake_case DB columns (house convention for Kysely) */

import type { Insertable, Selectable } from 'kysely';

// Models
import type { DeletionOffer } from '@fileshed/core';

// Database
import type { DeletionOfferTable } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

// A stored timestamp reads back as a Date (Postgres) or an ISO string (SQLite); new Date normalizes both (database.ts).
function toDate(value : Date | string) : Date
{
    return new Date(value);
}

//----------------------------------------------------------------------------------------------------------------------

export function offerFromRow(row : Selectable<DeletionOfferTable>) : DeletionOffer
{
    return {
        id: row.id,
        sha256: row.sha256,
        offereeID: row.offeree_id,
        name: row.name,
        mimeType: row.mime_type,
        size: row.size,
        createdBy: row.created_by,
        createdAt: toDate(row.created_at),
        expiresAt: toDate(row.expires_at),
    };
}

export function rowFromOffer(offer : DeletionOffer) : Insertable<DeletionOfferTable>
{
    return {
        id: offer.id,
        sha256: offer.sha256,
        offeree_id: offer.offereeID,
        name: offer.name,
        mime_type: offer.mimeType,
        size: offer.size,
        created_by: offer.createdBy,
        created_at: offer.createdAt.toISOString(),
        expires_at: offer.expiresAt.toISOString(),
    };
}

//----------------------------------------------------------------------------------------------------------------------
