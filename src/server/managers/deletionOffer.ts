//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Manager
//
// The offeree side of recipients-may-copy: list pending offers, accept one into an owned file node, decline one.
// Accepting is a save-a-copy from the offer's snapshot -- the materializer judges placement and quota, and the
// prepare callback it runs inside the insert transaction consumes the offer row and resurrects the blob, so the
// node, the resurrection, and the consumption commit together. An offer row that vanished underneath the accept (a
// concurrent accept or decline, or the GC cascade taking the blob) aborts as absent; a quota rejection rolls the
// whole transaction back, offer included, so the offeree can free space and retry.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type AcceptDeletionOfferRequest,
    type DeletionOfferListResponse,
    type NodeResponse,
    NotFoundError,
    toDeletionOfferListResponse,
} from '@fileshed/core';

// Managers
import type { FileCopySnapshot } from './node.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { DeletionOfferRA } from '../resource-access/deletionOffers/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// The one node-manager capability accepting needs; the composition root passes the NodeManager itself.
export interface SnapshotMaterializer
{
    materializeSnapshot(
        actor : SessionUser,
        snapshot : FileCopySnapshot,
        parentID : string | null,
        prepare ?: (trx : DatabaseHandle['db']) => Promise<void>
    ) : Promise<NodeResponse>;
}

export class DeletionOfferManager
{
    readonly #kind : DatabaseHandle['kind'];
    readonly #offers : DeletionOfferRA;
    readonly #materializer : SnapshotMaterializer;

    constructor(handle : DatabaseHandle, materializer : SnapshotMaterializer)
    {
        this.#kind = handle.kind;
        this.#offers = new DeletionOfferRA(handle);
        this.#materializer = materializer;
    }

    async list(actor : SessionUser) : Promise<DeletionOfferListResponse>
    {
        return toDeletionOfferListResponse(await this.#offers.listForOfferee(actor.id, new Date()));
    }

    async accept(actor : SessionUser, id : string, request : AcceptDeletionOfferRequest) : Promise<NodeResponse>
    {
        const offer = await this.#offers.getForOfferee(id, actor.id, new Date());
        if(offer === undefined) { throw new NotFoundError(`No deletion offer ${ id }.`); }

        const snapshot : FileCopySnapshot = {
            name: request.name ?? offer.name,
            mimeType: offer.mimeType,
            size: offer.size,
            blobID: offer.sha256,
        };

        return this.#materializer.materializeSnapshot(actor, snapshot, request.parentID, async (trx) =>
        {
            const consumed = await this.#offers.delete(offer.id, trx);
            if(!consumed) { throw new NotFoundError(`No deletion offer ${ id }.`); }

            await new BlobRA({ db: trx, kind: this.#kind }).resurrect(offer.sha256);
        });
    }

    async decline(actor : SessionUser, id : string) : Promise<void>
    {
        const offer = await this.#offers.getForOfferee(id, actor.id, new Date());
        if(offer === undefined) { throw new NotFoundError(`No deletion offer ${ id }.`); }

        await this.#offers.delete(offer.id);
    }
}

//----------------------------------------------------------------------------------------------------------------------
