//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Manager
//
// Accepting is a save-a-copy from the offer's snapshot -- the materializer judges placement and quota, and the prepare
// callback it runs inside the insert transaction consumes the offer row and resurrects the blob, so the node, the
// resurrection, and the consumption commit together. An offer row that vanished underneath the accept (a concurrent
// accept or decline, or the GC cascade taking the blob) aborts as absent; a quota rejection rolls the whole transaction
// back, offer included, so the offeree can free space and retry.
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
import type { SessionUser } from '../resource-access/auth/instance.ts';
import { BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { DeletionOfferRA } from '../resource-access/deletionOffers/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// The one node-manager capability accepting needs; the composition root passes the NodeManager itself.
export interface SnapshotMaterializer
{
    materializeSnapshot(
        user : SessionUser,
        snapshot : FileCopySnapshot,
        parentID : string | null,
        prepare ?: (tx : DatabaseHandle) => Promise<void>
    ) : Promise<NodeResponse>;
}

export interface DeletionOfferManagerDeps
{
    handle : DatabaseHandle;
    materializer : SnapshotMaterializer;
}

export class DeletionOfferManager
{
    readonly #offers : DeletionOfferRA;
    readonly #materializer : SnapshotMaterializer;

    constructor(deps : DeletionOfferManagerDeps)
    {
        this.#offers = new DeletionOfferRA(deps.handle);
        this.#materializer = deps.materializer;
    }

    async list(user : SessionUser) : Promise<DeletionOfferListResponse>
    {
        return toDeletionOfferListResponse(await this.#offers.listForOfferee(user.id, new Date()));
    }

    async accept(user : SessionUser, id : string, request : AcceptDeletionOfferRequest) : Promise<NodeResponse>
    {
        const offer = await this.#offers.getForOfferee(id, user.id, new Date());
        if(offer === undefined) { throw new NotFoundError(`No deletion offer ${ id }.`); }

        const snapshot : FileCopySnapshot = {
            name: request.name ?? offer.name,
            mimeType: offer.mimeType,
            size: offer.size,
            blobID: offer.sha256,
        };

        return this.#materializer.materializeSnapshot(user, snapshot, request.parentID, async (tx) =>
        {
            const consumed = await new DeletionOfferRA(tx).delete(offer.id);
            if(!consumed) { throw new NotFoundError(`No deletion offer ${ id }.`); }

            await new BlobRA(tx).resurrect(offer.sha256);
        });
    }

    async decline(user : SessionUser, id : string) : Promise<void>
    {
        const offer = await this.#offers.getForOfferee(id, user.id, new Date());
        if(offer === undefined) { throw new NotFoundError(`No deletion offer ${ id }.`); }

        await this.#offers.delete(offer.id);
    }
}

//----------------------------------------------------------------------------------------------------------------------
