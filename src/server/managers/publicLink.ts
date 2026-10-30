//----------------------------------------------------------------------------------------------------------------------
// Public Link Manager
//
// The direct link (/d/:token) and the authenticated download (/api/nodes/:id/download) both get their ServedFile from
// here. A live link is enough for the first; the second needs a viewer role on the node or better. Link management is
// owner-only, because sharing is the owner's authority.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    BadRequestError,
    BlobNotFoundError,
    type FileNode,
    ForbiddenError,
    MAX_LINKS_PER_NODE,
    type Node,
    NotFoundError,
    PUBLIC_LINK_TOKEN_BYTES,
    type PublicLink,
    type PublicLinkListResponse,
    type PublicLinkResponse,
    isDirectOwner,
    isHiddenTrash,
    toPublicLinkListResponse,
    toPublicLinkResponse,
} from '@fileshed/core';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';
import type { BlobRange } from '../resource-access/blob/backend.ts';
import { type BlobLocation, BlobRA } from '../resource-access/blob/index.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { NodeRA } from '../resource-access/nodes/index.ts';
import { PublicLinkRA } from '../resource-access/publicLinks/index.ts';
import { ShareRA } from '../resource-access/shares/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// A file a caller may have the bytes of, before any are read. open() reads the whole blob or one window of it.
export interface ServedFile
{
    name : string;
    mimeType : string;
    size : number;
    sha256 : string;
    open(window ?: BlobRange) : Promise<Readable>;
}

//----------------------------------------------------------------------------------------------------------------------

export interface PublicLinkManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;
}

export class PublicLinkManager
{
    readonly #nodes : NodeRA;
    readonly #blob : BlobRA;
    readonly #links : PublicLinkRA;
    readonly #shares : ShareRA;

    constructor(deps : PublicLinkManagerDeps)
    {
        this.#nodes = new NodeRA(deps.handle);
        this.#blob = deps.blob;
        this.#links = new PublicLinkRA(deps.handle);
        this.#shares = new ShareRA(deps.handle);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Link lifecycle (owner only)
    //------------------------------------------------------------------------------------------------------------------

    // Mint a public link on a file node. Sharing is the owner's authority, and a public link references a
    // file node -- folders carry no bytes to serve -- so a non-file is refused. A link has nothing to configure and
    // several per node are ok (an owner may want separately revocable tokens), so nothing here dedups.
    async createLink(user : SessionUser, nodeID : string) : Promise<PublicLinkResponse>
    {
        const node = await this.#requireOwnedNode(user, nodeID);

        if(node.type !== 'file')
        {
            throw new BadRequestError('A public link can only target a file node.');
        }

        const live = (await this.#links.listByNode(nodeID)).filter((existing) => existing.revoked === null);
        if(live.length >= MAX_LINKS_PER_NODE)
        {
            throw new BadRequestError(
                `This file already has the maximum of ${ MAX_LINKS_PER_NODE } links. Revoke one to mint another.`
            );
        }

        const link : PublicLink = {
            id: createId(),
            nodeID,
            token: randomBytes(PUBLIC_LINK_TOKEN_BYTES).toString('base64url'),
            created: new Date(),
            revoked: null,
        };
        await this.#links.insert(link);

        return toPublicLinkResponse(link);
    }

    async listForNode(user : SessionUser, nodeID : string) : Promise<PublicLinkListResponse>
    {
        await this.#requireOwnedNode(user, nodeID);

        return toPublicLinkListResponse(await this.#links.listByNode(nodeID));
    }

    async revoke(user : SessionUser, linkID : string) : Promise<void>
    {
        const link = await this.#links.getByID(linkID);
        if(link === undefined) { throw new NotFoundError(`No link ${ linkID }.`); }

        // The node backs the ownership check; the node_id FK cascade means a live link always has its node.
        const node = await this.#nodes.get(link.nodeID);
        if(node === undefined || !isDirectOwner(node, user.id))
        {
            throw new ForbiddenError('Only the owner may revoke this link.');
        }

        await this.#links.revoke(linkID);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Byte serving
    //------------------------------------------------------------------------------------------------------------------

    // GET /d/:token -- anonymous, no auth. The token resolves to a link; a dead link (unknown token, revoked,
    // or a target that is gone, not a file, or trashed) serves nothing. A trashed target must never serve publicly:
    // a trashed node is hidden from everyone, and setTrashed marks the whole subtree, so the node's own trashed
    // catches an ancestor-trashed file too. Every dead outcome is a 404 that never distinguishes "revoked" from "gone"
    // -- the same reads-as-absent idiom the node manager uses for no-access reads.
    //
    async downloadByToken(token : string) : Promise<ServedFile>
    {
        const link = await this.#links.getByToken(token);
        if(link === undefined) { throw new NotFoundError('No such link.'); }
        if(link.revoked !== null) { throw new NotFoundError('This link is no longer available.'); }

        const node = await this.#nodes.get(link.nodeID);
        if(node === undefined || node.type !== 'file' || node.trashed !== null)
        {
            throw new NotFoundError('This link is no longer available.');
        }

        return this.#served(node);
    }

    // GET /api/nodes/:id/download -- authed, same Range/ETag behavior as the public link. Viewer suffices to
    // download, so authorization is the resolved role, not an owner check; no access reads as absent (404).
    //
    // Trashing hides a node from every recipient, and setTrashed stamps the whole subtree -- so trashing a
    // shared folder must cut off its files' bytes too, not just their listings, or a recipient could still pull them
    // through this endpoint. The OWNER is exempt: their own trash stays theirs to retrieve until it purges. Ownership
    // is tested directly rather than through the resolved role, so the exemption can never widen to whoever a resolver
    // decides is 'owner'.
    async download(user : SessionUser, nodeID : string) : Promise<ServedFile>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }

        const role = await this.#shares.effectiveRole(user.id, node.id);
        if(role === null) { throw new NotFoundError(`No node ${ nodeID }.`); }

        // Only files have bytes; a folder or link is not a downloadable resource on this endpoint.
        if(node.type !== 'file') { throw new NotFoundError(`No downloadable file ${ nodeID }.`); }

        if(isHiddenTrash(node, user.id))
        {
            throw new NotFoundError(`No node ${ nodeID }.`);
        }

        return this.#served(node);
    }

    //------------------------------------------------------------------------------------------------------------------
    // The served file
    //------------------------------------------------------------------------------------------------------------------

    // The blob record pins where the bytes live and carries their authoritative byte count. A missing record for a
    // live file node is store corruption, surfaced as absent.
    async #served(node : FileNode) : Promise<ServedFile>
    {
        const blob = await this.#blob.get(node.blobID);
        if(blob === undefined) { throw new NotFoundError('The content backing this file is unavailable.'); }

        return {
            name: node.name,
            mimeType: node.mimeType,
            size: blob.size,
            sha256: node.blobID,
            open: (window) => this.#open(blob, window),
        };
    }

    // Open the byte stream, mapping a vanished blob (GC raced the read) to the same absent outcome as a missing record.
    async #open(location : BlobLocation, window ?: BlobRange) : Promise<Readable>
    {
        try
        {
            return await this.#blob.getStream(location, window);
        }
        catch(error)
        {
            if(error instanceof BlobNotFoundError)
            {
                throw new NotFoundError('The content backing this file is unavailable.');
            }
            throw error;
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Ownership gate
    //------------------------------------------------------------------------------------------------------------------

    // Fetch + authority gate for the owner-only management paths (create/list/revoke). A missing node is 404; a node
    // owned by someone else is 403 -- these operations name the node the caller supplied, so we say plainly it is not
    // theirs. Publishing a link is authority over the node, not access to it, so this asks isDirectOwner rather than
    // the effective role: a folder owner resolves 'owner' on a file contributed into their folder and may read
    // it, but must not be able to publish content they do not own.
    async #requireOwnedNode(user : SessionUser, nodeID : string) : Promise<Node>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }
        if(!isDirectOwner(node, user.id))
        {
            throw new ForbiddenError('Only the owner may manage links for this node.');
        }

        return node;
    }
}

//----------------------------------------------------------------------------------------------------------------------
