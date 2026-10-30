//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Resource Access
//
// Expiry is enforced at read time, so an expired row reads as absent. Rows past their window need no sweeper of their
// own: expires_at is the blob's GC grace deadline, so when GC hard-deletes the blob row, the sha256 FK cascade removes
// every offer on it.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { DeletionOffer } from '@fileshed/core';

// Database
import type { DatabaseHandle } from '../database/database.ts';

// Transforms
import { offerFromRow, rowFromOffer } from './transforms.ts';

//----------------------------------------------------------------------------------------------------------------------

export class DeletionOfferRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    async insertMany(offers : DeletionOffer[]) : Promise<void>
    {
        if(offers.length === 0) { return; }

        await this.#db
            .insertInto('deletion_offer')
            .values(offers.map(rowFromOffer))
            .execute();
    }

    async listForOfferee(offereeID : string, now : Date) : Promise<DeletionOffer[]>
    {
        const rows = await this.#db
            .selectFrom('deletion_offer')
            .selectAll()
            .where('offeree_id', '=', offereeID)
            .where('expires_at', '>', now.toISOString())
            .orderBy('created_at', 'asc')
            .execute();

        return rows.map(offerFromRow);
    }

    async getForOfferee(id : string, offereeID : string, now : Date) : Promise<DeletionOffer | undefined>
    {
        const row = await this.#db
            .selectFrom('deletion_offer')
            .selectAll()
            .where('id', '=', id)
            .where('offeree_id', '=', offereeID)
            .where('expires_at', '>', now.toISOString())
            .executeTakeFirst();

        return row === undefined ? undefined : offerFromRow(row);
    }

    // True when the row was still there to delete -- the accept path consumes the offer inside its transaction and
    // treats an already-gone row (a concurrent accept, decline, or GC cascade) as absent.
    async delete(id : string) : Promise<boolean>
    {
        const result = await this.#db
            .deleteFrom('deletion_offer')
            .where('id', '=', id)
            .executeTakeFirst();

        return result.numDeletedRows > 0n;
    }
}

//----------------------------------------------------------------------------------------------------------------------
