//----------------------------------------------------------------------------------------------------------------------
// Public Link Manager
//
// Two jobs, one shared core:
//
//   1. Link lifecycle -- mint a public link on a file node (owner only, files only, multiple links per node allowed),
//      list a node's links, revoke one. Sharing is the owner's authority, so every management path is owner-
//      gated; a folder has no bytes to serve, so link creation on a non-file is refused.
//
//   2. Byte serving -- the two consumers that stream a file node's bytes: the anonymous /d/:token direct link, and the
//      authed /api/nodes/:id/download endpoint. Both funnel through streamFileNode, which does the whole HTTP/1.1
//      byte-serving contract: 200 or 206, ETag = the blob sha256 (strong), If-None-Match -> 304, Accept-Ranges
//      bytes, correct Content-Length, Content-Range on partials, 416 on an unsatisfiable range, Content-Type from the
//      node, and Content-Disposition per the caller's inline/attachment choice.
//
// The download endpoint's authorization is an injected role resolver, so this manager never hard-codes an owner check
// for reads: viewer suffices to download. The resolver is required -- there is deliberately no ownership-only
// fallback, since a construction that silently degraded to owner-only auth would be a security hole wearing a default.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    BadRequestError,
    BlobNotFoundError,
    type CreatePublicLinkRequest,
    type FileNode,
    ForbiddenError,
    type Node,
    NotFoundError,
    PUBLIC_LINK_TOKEN_BYTES,
    type PublicLink,
    type PublicLinkDisposition,
    type Role,
    isDirectOwner,
} from '@fileshed/core';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import { type BlobLocation, BlobRA } from '../resource-access/blob/index.ts';
import { NodeRA } from '../resource-access/nodes/node.ts';
import { PublicLinkRA } from '../resource-access/publicLinks/index.ts';

//----------------------------------------------------------------------------------------------------------------------
// The download-authorization seam: the caller's effective role on a node, or null for no access. Shaped to
// match ShareRA.effectiveRole, which is what satisfies it.
//----------------------------------------------------------------------------------------------------------------------

export type RoleResolver = (userID : string, nodeID : string) => Promise<Role | null>;

//----------------------------------------------------------------------------------------------------------------------
// The byte-serving result a route turns into an HTTP response. status is the outcome; headers is the exact set to
// emit; stream is the body for 200/206 and null for the bodiless 304/416.
//----------------------------------------------------------------------------------------------------------------------

export interface StreamResult
{
    status : 200 | 206 | 304 | 416;
    headers : Record<string, string>;
    stream : Readable | null;
}

interface StreamOptions
{
    disposition : PublicLinkDisposition;
    rangeHeader ?: string;
    ifNoneMatch ?: string;
}

//----------------------------------------------------------------------------------------------------------------------
// Range parsing (a single byte range is sufficient). A single satisfiable range yields a window; an out-of-bounds
// range is unsatisfiable (416); everything else -- no header, a non-bytes unit, a multi-range set, or a malformed
// spec -- falls back to the full body (200), which RFC 7233 explicitly permits a server to do.
//----------------------------------------------------------------------------------------------------------------------

interface ByteWindow
{
    offset : number;
    length : number;
}

type RangePlan
    = | { kind : 'full' }
    | { kind : 'partial'; window : ByteWindow }
    | { kind : 'unsatisfiable' };

function parseRange(header : string | undefined, size : number) : RangePlan
{
    if(header === undefined) { return { kind: 'full' }; }

    const unit = /^bytes=(.+)$/.exec(header.trim());
    if(unit === null) { return { kind: 'full' }; }

    // Multiple comma-separated ranges are not served as multipart/byteranges here; a single range is enough,
    // so the whole body is returned instead -- always a valid response to any range request.
    const spec = (unit[1] ?? '').trim();
    if(spec.includes(',')) { return { kind: 'full' }; }

    const bounds = /^(\d*)-(\d*)$/.exec(spec);
    if(bounds === null) { return { kind: 'full' }; }

    const startText = bounds[1] ?? '';
    const endText = bounds[2] ?? '';

    // "bytes=-N": the final N bytes. A zero-width window -- N == 0, or any suffix against an empty blob -- names no
    // bytes at all, so there is nothing satisfiable to return.
    if(startText === '')
    {
        if(endText === '') { return { kind: 'full' }; }

        const length = Math.min(Number(endText), size);
        if(length === 0) { return { kind: 'unsatisfiable' }; }

        return { kind: 'partial', window: { offset: size - length, length } };
    }

    const start = Number(startText);
    if(start >= size) { return { kind: 'unsatisfiable' }; }

    // A last-byte-pos below first-byte-pos makes the byte-range-spec INVALID rather than unsatisfiable, and RFC 7233
    // §2.1 says an invalid spec is ignored -- so the full body is served. 416 is reserved for a syntactically valid
    // range that simply falls outside the blob (first-byte-pos >= length, caught above).
    const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
    if(end < start) { return { kind: 'full' }; }

    return { kind: 'partial', window: { offset: start, length: (end - start) + 1 } };
}

//----------------------------------------------------------------------------------------------------------------------
// Header helpers
//----------------------------------------------------------------------------------------------------------------------

// A strong ETag over the blob's content hash (the sha256 is the natural etag). The blob id IS the sha256.
function strongEtag(sha256 : string) : string
{
    return `"${ sha256 }"`;
}

const NON_ASCII = /[^\x20-\x7e]/;
const NON_ASCII_GLOBAL = /[^\x20-\x7e]/g;

// Content-Disposition per RFC 6266: an inline hotlink or a forced download, always with a filename. A non-ASCII
// name can't ride the quoted `filename` param, so a sanitized ASCII fallback is paired with an RFC 5987 `filename*`
// carrying the real UTF-8 name percent-encoded. Quotes and backslashes are stripped from the fallback so they cannot
// break out of the quoted-string.
function contentDisposition(disposition : PublicLinkDisposition, filename : string) : string
{
    const type = disposition === 'attachment' ? 'attachment' : 'inline';
    const asciiFallback = filename.replace(NON_ASCII_GLOBAL, '_').replace(/["\\]/g, '_');

    if(NON_ASCII.test(filename))
    {
        return `${ type }; filename="${ asciiFallback }"; filename*=UTF-8''${ encodeURIComponent(filename) }`;
    }

    return `${ type }; filename="${ asciiFallback }"`;
}

// Whether If-None-Match matches the current representation. `*` matches anything; otherwise each listed entry
// is compared to the sha256 after stripping an optional weak (`W/`) marker and the surrounding quotes.
function ifNoneMatchHits(header : string | undefined, sha256 : string) : boolean
{
    if(header === undefined) { return false; }

    const value = header.trim();
    if(value === '*') { return true; }

    return value.split(',').some((raw) =>
    {
        let tag = raw.trim();
        if(tag.startsWith('W/')) { tag = tag.slice(2).trim(); }
        if(tag.startsWith('"') && tag.endsWith('"')) { tag = tag.slice(1, -1); }
        return tag === sha256;
    });
}

//----------------------------------------------------------------------------------------------------------------------

export class PublicLinkManager
{
    readonly #nodes : NodeRA;
    readonly #blob : BlobRA;
    readonly #links : PublicLinkRA;
    readonly #resolveRole : RoleResolver;

    constructor(nodes : NodeRA, blob : BlobRA, links : PublicLinkRA, resolveRole : RoleResolver)
    {
        this.#nodes = nodes;
        this.#blob = blob;
        this.#links = links;
        this.#resolveRole = resolveRole;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Link lifecycle (owner only)
    //------------------------------------------------------------------------------------------------------------------

    // Mint a public link on a file node. Sharing is the owner's authority, and a public link references a
    // file node -- folders carry no bytes to serve -- so a non-file is refused. Multiple links per node are ok
    // (one inline, one download), so nothing here dedups.
    async createLink(actor : SessionUser, nodeID : string, request : CreatePublicLinkRequest) : Promise<PublicLink>
    {
        const node = await this.#requireOwnedNode(actor, nodeID);

        if(node.type !== 'file')
        {
            throw new BadRequestError('A public link can only target a file node.');
        }

        const now = new Date();
        const link : PublicLink = {
            id: createId(),
            nodeID,
            token: randomBytes(PUBLIC_LINK_TOKEN_BYTES).toString('base64url'),
            mode: request.mode,
            disposition: request.disposition,
            createdAt: now,
            revokedAt: null,
        };
        await this.#links.insert(link);

        return link;
    }

    async listForNode(actor : SessionUser, nodeID : string) : Promise<PublicLink[]>
    {
        await this.#requireOwnedNode(actor, nodeID);

        return this.#links.listByNode(nodeID);
    }

    async revoke(actor : SessionUser, linkID : string) : Promise<void>
    {
        const link = await this.#links.getByID(linkID);
        if(link === undefined) { throw new NotFoundError(`No link ${ linkID }.`); }

        // The node backs the ownership check; the node_id FK cascade means a live link always has its node.
        const node = await this.#nodes.get(link.nodeID);
        if(node === undefined || !isDirectOwner(node, actor.id))
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
    // a trashed node is hidden from everyone, and setTrashed marks the whole subtree, so the node's own trashedAt
    // catches an ancestor-trashed file too. Every dead outcome is a 404 that never distinguishes "revoked" from "gone"
    // -- the same reads-as-absent idiom the node manager uses for no-access reads.
    async resolveByToken(token : string, options : Omit<StreamOptions, 'disposition'>) : Promise<StreamResult>
    {
        const link = await this.#links.getByToken(token);
        if(link === undefined) { throw new NotFoundError('No such link.'); }
        if(link.revokedAt !== null) { throw new NotFoundError('This link is no longer available.'); }

        const node = await this.#nodes.get(link.nodeID);
        if(node === undefined || node.type !== 'file' || node.trashedAt !== null)
        {
            throw new NotFoundError('This link is no longer available.');
        }

        return this.#streamFileNode(node, { ...options, disposition: link.disposition });
    }

    // GET /api/nodes/:id/download -- authed, same Range/ETag behavior as the public link. Viewer suffices to
    // download, so authorization is the injected role resolver, not an owner check; no access reads as absent (404).
    // Disposition is the caller's choice (?disposition=), defaulting to attachment at the route.
    //
    // Trashing hides a node from every recipient, and setTrashed stamps the whole subtree -- so trashing a
    // shared folder must cut off its files' bytes too, not just their listings, or a recipient could still pull them
    // through this endpoint. The OWNER is exempt: their own trash stays theirs to retrieve until it purges. Ownership
    // is tested directly rather than through the resolved role, so the exemption can never widen to whoever a resolver
    // decides is 'owner'.
    async download(actor : SessionUser, nodeID : string, options : StreamOptions) : Promise<StreamResult>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }

        const role = await this.#resolveRole(actor.id, node.id);
        if(role === null) { throw new NotFoundError(`No node ${ nodeID }.`); }

        // Only files have bytes; a folder or link is not a downloadable resource on this endpoint.
        if(node.type !== 'file') { throw new NotFoundError(`No downloadable file ${ nodeID }.`); }

        if(node.trashedAt !== null && !isDirectOwner(node, actor.id))
        {
            throw new NotFoundError(`No node ${ nodeID }.`);
        }

        return this.#streamFileNode(node, options);
    }

    //------------------------------------------------------------------------------------------------------------------
    // The shared byte-serving contract
    //------------------------------------------------------------------------------------------------------------------

    async #streamFileNode(node : FileNode, options : StreamOptions) : Promise<StreamResult>
    {
        // The blob record pins where the bytes live and carries their authoritative byte count -- the basis for the
        // range math and Content-Length. A missing record for a live file node is store corruption, surfaced as absent.
        const blob = await this.#blob.get(node.blobID);
        if(blob === undefined) { throw new NotFoundError('The content backing this file is unavailable.'); }

        const sha256 = node.blobID;
        const etag = strongEtag(sha256);

        // If-None-Match is evaluated ahead of Range (RFC 7232): a matching validator returns a bodiless 304 regardless
        // of any range.
        if(ifNoneMatchHits(options.ifNoneMatch, sha256))
        {
            return { status: 304, headers: { 'accept-ranges': 'bytes', etag }, stream: null };
        }

        const plan = parseRange(options.rangeHeader, blob.size);

        if(plan.kind === 'unsatisfiable')
        {
            return {
                status: 416,
                headers: { 'accept-ranges': 'bytes', etag, 'content-range': `bytes */${ blob.size }` },
                stream: null,
            };
        }

        const disposition = contentDisposition(options.disposition, node.name);
        const location : BlobLocation = { backendID: blob.backendID, storageKey: blob.storageKey };

        if(plan.kind === 'full')
        {
            return {
                status: 200,
                headers: {
                    'accept-ranges': 'bytes',
                    'content-disposition': disposition,
                    'content-length': String(blob.size),
                    'content-type': node.mimeType,
                    etag,
                },
                stream: await this.#open(location),
            };
        }

        const { offset, length } = plan.window;
        return {
            status: 206,
            headers: {
                'accept-ranges': 'bytes',
                'content-disposition': disposition,
                'content-length': String(length),
                'content-range': `bytes ${ offset }-${ (offset + length) - 1 }/${ blob.size }`,
                'content-type': node.mimeType,
                etag,
            },
            stream: await this.#open(location, { offset, length }),
        };
    }

    // Open the byte stream, mapping a vanished blob (GC raced the read) to the same absent outcome as a missing record.
    async #open(location : BlobLocation, range ?: ByteWindow) : Promise<Readable>
    {
        try
        {
            return await this.#blob.getStream(location, range);
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
    // the role resolver: a folder owner resolves 'owner' on a file contributed into their folder and may read
    // it, but must not be able to publish content they do not own.
    async #requireOwnedNode(actor : SessionUser, nodeID : string) : Promise<Node>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }
        if(!isDirectOwner(node, actor.id))
        {
            throw new ForbiddenError('Only the owner may manage links for this node.');
        }

        return node;
    }
}

//----------------------------------------------------------------------------------------------------------------------
