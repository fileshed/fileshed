//----------------------------------------------------------------------------------------------------------------------
// Blob Manager
//
// The claim / proof-of-possession / upload flow. A claim is admitted against the owner's quota first, then routed: an
// unknown blob gets a single-use upload ticket; a known blob (graveyarded or not) that is worth the round trip gets a
// proof-of-possession challenge instead of re-uploading the bytes. Answering a challenge or completing an upload
// creates the caller's file node -- for a known blob, resurrecting the record if it was graveyarded -- in one
// transaction.
//
// Tickets, challenges, and the failed-proof counter are in-memory: a single-node deployment, and losing them on
// restart only forces a client to re-claim. Expiry is enforced lazily on use (an expired entry is never honoured) and
// swept in the background to bound growth.
//----------------------------------------------------------------------------------------------------------------------

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { type Readable, Transform, type TransformCallback } from 'node:stream';

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    BadRequestError,
    BlobNotFoundError,
    CHALLENGE_TTL_MS,
    type ClaimRequest,
    type ClaimResponse,
    ConflictError,
    FAILED_PROOF_WINDOW_MS,
    type FileNode,
    ForbiddenError,
    HashMismatchError,
    MAX_CHALLENGE_RANGES,
    MAX_CHALLENGE_RANGE_BYTES,
    MAX_FAILED_PROOFS,
    MIN_CHALLENGE_RANGES,
    NONCE_BYTES,
    type Node,
    NotFoundError,
    PayloadTooLargeError,
    RegulationError,
    type Role,
    SMALL_FILE_THRESHOLD_BYTES,
    SWEEP_INTERVAL_MS,
    SizeMismatchError,
    TICKET_TTL_MS,
    TooManyRequestsError,
    type UploadCommitCreate,
    type UploadCommitMetadata,
    isDirectOwner,
} from '@fileshed/core';

// Engines
import { effectiveQuota } from '../engines/quota.ts';
import { regulation } from '../engines/regulation/index.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { type BlobLocation, BlobRA } from '../resource-access/blob/index.ts';
import { NodeRA } from '../resource-access/nodes/node.ts';
import { ShareRA } from '../resource-access/shares/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------
// In-memory stores
//----------------------------------------------------------------------------------------------------------------------

interface Ticket
{
    id : string;
    sha256 : string;
    size : number;
    ownerID : string;
    expiresAt : number;
}

// Single-use upload tickets. consume deletes on first use and refuses an expired one.
class TicketStore
{
    readonly #tickets = new Map<string, Ticket>();

    issue(sha256 : string, size : number, ownerID : string) : Ticket
    {
        const ticket : Ticket = { id: createId(), sha256, size, ownerID, expiresAt: Date.now() + TICKET_TTL_MS };
        this.#tickets.set(ticket.id, ticket);
        return ticket;
    }

    consume(id : string) : Ticket | undefined
    {
        const ticket = this.#tickets.get(id);
        if(ticket === undefined) { return undefined; }

        this.#tickets.delete(id);
        return ticket.expiresAt > Date.now() ? ticket : undefined;
    }

    sweep() : void
    {
        const now = Date.now();
        for(const [ id, ticket ] of this.#tickets)
        {
            if(ticket.expiresAt <= now) { this.#tickets.delete(id); }
        }
    }
}

interface Challenge
{
    id : string;
    sha256 : string;
    size : number;
    ownerID : string;
    nonce : string;
    ranges : [ number, number ][];
    location : BlobLocation;
    expiresAt : number;
}

// Single-use proof-of-possession challenges. Same consume-once, expire-fast contract as tickets.
class ChallengeStore
{
    readonly #challenges = new Map<string, Challenge>();

    issue(init : Omit<Challenge, 'id' | 'expiresAt'>) : Challenge
    {
        const challenge : Challenge = { ...init, id: createId(), expiresAt: Date.now() + CHALLENGE_TTL_MS };
        this.#challenges.set(challenge.id, challenge);
        return challenge;
    }

    consume(id : string) : Challenge | undefined
    {
        const challenge = this.#challenges.get(id);
        if(challenge === undefined) { return undefined; }

        this.#challenges.delete(id);
        return challenge.expiresAt > Date.now() ? challenge : undefined;
    }

    sweep() : void
    {
        const now = Date.now();
        for(const [ id, challenge ] of this.#challenges)
        {
            if(challenge.expiresAt <= now) { this.#challenges.delete(id); }
        }
    }
}

// Per-user sliding count of recent failed proofs. Timestamps older than the window are pruned on each touch.
class FailedProofTracker
{
    readonly #failures = new Map<string, number[]>();

    #recent(userID : string) : number[]
    {
        const cutoff = Date.now() - FAILED_PROOF_WINDOW_MS;
        const recent = (this.#failures.get(userID) ?? []).filter((at) => at > cutoff);

        if(recent.length === 0) { this.#failures.delete(userID); }
        else { this.#failures.set(userID, recent); }

        return recent;
    }

    isLimited(userID : string) : boolean
    {
        return this.#recent(userID).length >= MAX_FAILED_PROOFS;
    }

    record(userID : string) : void
    {
        const recent = this.#recent(userID);
        recent.push(Date.now());
        this.#failures.set(userID, recent);
    }

    sweep() : void
    {
        for(const userID of [ ...this.#failures.keys() ]) { this.#recent(userID); }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Proof-of-possession primitives
//----------------------------------------------------------------------------------------------------------------------

// Crypto-random offsets AND lengths, each window inside [0, size). offset in [0, size) then length in
// [1, min(size - offset, cap)] keeps every window in bounds without a rejection loop. Challenges only issue for blobs
// at or above the 1 MiB threshold, so there is always room for a non-trivial window.
function randomRanges(size : number) : [ number, number ][]
{
    const count = randomInt(MIN_CHALLENGE_RANGES, MAX_CHALLENGE_RANGES + 1);
    const ranges : [ number, number ][] = [];

    for(let index = 0; index < count; index++)
    {
        const offset = randomInt(0, size);
        const maxLength = Math.min(size - offset, MAX_CHALLENGE_RANGE_BYTES);
        ranges.push([ offset, randomInt(1, maxLength + 1) ]);
    }

    return ranges;
}

// The expected answer: read the same windows the challenge named, in order, and HMAC-SHA256 their concatenation keyed
// by the nonce. Keying by the per-challenge nonce is what stops an answer captured on one challenge from
// satisfying another.
async function computeProof(
    blob : BlobRA,
    location : BlobLocation,
    ranges : [ number, number ][],
    nonce : string
) : Promise<string>
{
    const windows = await Promise.all(ranges.map(([ offset, length ]) => blob.read(location, offset, length)));

    const hmac = createHmac('sha256', nonce);
    for(const window of windows) { hmac.update(window); }

    return hmac.digest('hex');
}

// Constant-time comparison of two hex digests. timingSafeEqual needs equal-length buffers, so a malformed or
// wrong-length answer is rejected up front -- its length is not the secret, so the early return leaks nothing useful.
function proofMatches(expected : string, provided : string) : boolean
{
    const expectedBytes = Buffer.from(expected, 'hex');
    const providedBytes = Buffer.from(provided, 'hex');

    if(expectedBytes.length === 0 || expectedBytes.length !== providedBytes.length) { return false; }

    return timingSafeEqual(expectedBytes, providedBytes);
}

// Caps the streamed byte count at the claimed size while an upload is in flight: a client that streams
// more than it claimed is aborted at the first excess byte, which rejects the put pipeline and cleans its staging file,
// so a size lie can never push gigabytes onto disk. Exceeding the claimed size is the same size mismatch the store
// would catch after the fact (400), so the limiter raises it as one.
function byteLimiter(maxBytes : number) : Transform
{
    let seen = 0;

    return new Transform({
        transform(chunk : Buffer, _encoding : BufferEncoding, callback : TransformCallback) : void
        {
            seen += chunk.length;
            if(seen > maxBytes)
            {
                callback(new BadRequestError('Uploaded byte count exceeds the claimed size.'));
                return;
            }
            callback(null, chunk);
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

export interface BlobManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at use time, per request, so an admin raising or lowering the cap needs no restart.
    uploadMaxBytes : () => Promise<number>;

    // The instance-wide quota every account with no limit of its own inherits, likewise read per use.
    defaultQuota : () => Promise<number>;
}

// A committed file node with the caller's effective role on it, so the route stamps the real role rather than
// assuming ownership: a create is always the caller's own ('owner'), but a replace may be run by an editor on a file
// shared to them, whose response must carry 'editor'.
export interface CommittedNode
{
    node : FileNode;
    role : Role;
}

//----------------------------------------------------------------------------------------------------------------------

export class BlobManager
{
    readonly #handle : DatabaseHandle;
    readonly #blob : BlobRA;
    readonly #uploadMaxBytes : () => Promise<number>;
    readonly #defaultQuota : () => Promise<number>;

    readonly #nodes : NodeRA;
    readonly #shares : ShareRA;
    readonly #users : UserRA;

    readonly #tickets = new TicketStore();
    readonly #challenges = new ChallengeStore();
    readonly #failedProofs = new FailedProofTracker();

    readonly #logger = getLogger('blob');

    constructor(deps : BlobManagerDeps)
    {
        this.#handle = deps.handle;
        this.#blob = deps.blob;
        this.#uploadMaxBytes = deps.uploadMaxBytes;
        this.#defaultQuota = deps.defaultQuota;

        this.#nodes = new NodeRA(deps.handle);
        this.#shares = new ShareRA(deps.handle);
        this.#users = new UserRA(deps.handle);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Claim
    //------------------------------------------------------------------------------------------------------------------

    // POST /api/blobs/claim. The blob is resolved first so quota and the ticket/challenge routing decide against the
    // authoritative size, not a size the client invented: unknown -> upload ticket; known and large ->
    // proof-of-possession challenge; known but small -> ticket (round trips cost more than the bytes).
    async claim(caller : SessionUser, request : ClaimRequest) : Promise<ClaimResponse>
    {
        const existing = await this.#blob.get(request.sha256);

        // Content-addressed: a known sha256 has exactly one size, so a claim that disagrees is a lying client -- reject
        // it rather than admit quota or pick the ticket/challenge branch against a fabricated size (which would let a
        // caller under-report to slip past quota, or under-report a large blob into the ticket path to skip the proof).
        if(existing !== undefined && request.size !== existing.size)
        {
            throw new BadRequestError('Claimed size does not match the known blob.');
        }

        const size = existing?.size ?? request.size;
        await this.#admitQuota(caller, size);

        if(existing === undefined)
        {
            if(size > await this.#uploadMaxBytes())
            {
                throw new PayloadTooLargeError('File exceeds the maximum upload size.');
            }
            return { upload: true, ticket: this.#tickets.issue(request.sha256, size, caller.id).id };
        }

        if(size < SMALL_FILE_THRESHOLD_BYTES)
        {
            return { upload: true, ticket: this.#tickets.issue(request.sha256, size, caller.id).id };
        }

        const nonce = randomBytes(NONCE_BYTES).toString('hex');
        const ranges = randomRanges(size);
        const challenge = this.#challenges.issue({
            sha256: request.sha256,
            size,
            ownerID: caller.id,
            nonce,
            ranges,
            location: { backendID: existing.backendID, storageKey: existing.storageKey },
        });

        return { upload: false, challengeID: challenge.id, nonce, ranges };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Proof-of-possession answer
    //------------------------------------------------------------------------------------------------------------------

    // POST /api/blobs/claim/:challengeID. Recompute the proof over the challenge's ranges, compare in constant time,
    // and on success commit (resurrecting a graveyarded blob) with zero bytes moved -- creating the caller's node, or
    // replacing an existing file's content in place. A failed proof is logged and counted toward the per-user rate
    // limit (a failure is probing), and is gated ahead of the target resolution so a probe learns nothing about it.
    async answerChallenge(caller : SessionUser, challengeID : string, answer : string, metadata : UploadCommitMetadata)
    : Promise<CommittedNode>
    {
        if(this.#failedProofs.isLimited(caller.id))
        {
            throw new TooManyRequestsError('Too many failed proofs; try again later.');
        }

        const challenge = this.#challenges.consume(challengeID);
        if(challenge === undefined) { throw new NotFoundError('Challenge not found or expired.'); }
        if(challenge.ownerID !== caller.id) { throw new ForbiddenError('This challenge belongs to another user.'); }

        let expected : string;
        try
        {
            expected = await computeProof(this.#blob, challenge.location, challenge.ranges, challenge.nonce);
        }
        catch(error)
        {
            // The bytes vanished under the challenge -- GC hard-deleted them inside the window. That is a server-side
            // race, not the client probing a hash it lacks, so it is NOT counted toward the failed-proof rate limit.
            // The blob is simply gone; the client must re-claim.
            if(error instanceof BlobNotFoundError)
            {
                this.#logger.info({ userID: caller.id, sha256: challenge.sha256 }, 'Challenge blob vanished mid-proof');
                throw new NotFoundError('The blob is no longer available; re-claim to upload.');
            }
            throw error;
        }

        if(!proofMatches(expected, answer))
        {
            this.#failedProofs.record(caller.id);
            this.#logger.warn({ userID: caller.id, sha256: challenge.sha256 }, 'Failed proof-of-possession');
            throw new ForbiddenError('Proof of possession failed.');
        }

        // Known blob: the record already exists, so persistBlob only clears its graveyard marker. If GC hard-deleted
        // the record in the challenge window, resurrect touches nothing and the write fails the blob_id FK.
        const persistBlob = (blob : BlobRA) : Promise<void> => blob.resurrect(challenge.sha256);

        if('replaceNodeID' in metadata)
        {
            const { target, role } = await this.#prepareReplace(caller, metadata.replaceNodeID);
            return this.#commitReplace(
                target,
                role,
                challenge.sha256,
                challenge.size,
                metadata.mimeType,
                metadata.ifBlobID,
                persistBlob
            );
        }

        await this.#assertParentEdge(caller.id, metadata.parentID);
        const node = await this.#commitFileNode(caller, challenge.sha256, challenge.size, metadata, persistBlob);

        return { node, role: 'owner' };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Upload commit
    //------------------------------------------------------------------------------------------------------------------

    // PUT /api/uploads/:ticket. Stream the body through the store (which verifies hash + size and rejects a liar),
    // enforcing the byte ceiling as it goes, then commit in one transaction: create the caller's node, or replace an
    // existing file's content in place. The placement/target facts are gathered BEFORE the bytes stream, so a bad
    // target or parent stores nothing. The ticket is single-use: consumed here whether or not the upload succeeds.
    async commitUpload(
        caller : SessionUser,
        ticketID : string,
        body : Readable,
        metadata : UploadCommitMetadata,
        contentLength : number | undefined
    ) : Promise<CommittedNode>
    {
        const ticket = this.#tickets.consume(ticketID);
        if(ticket === undefined) { throw new NotFoundError('Upload ticket not found or expired.'); }
        if(ticket.ownerID !== caller.id) { throw new ForbiddenError('This ticket belongs to another user.'); }

        if(contentLength !== undefined && contentLength !== ticket.size)
        {
            throw new BadRequestError('Content-Length does not match the claimed size.');
        }
        if(contentLength !== undefined && contentLength > await this.#uploadMaxBytes())
        {
            throw new PayloadTooLargeError('Upload exceeds the maximum allowed size.');
        }

        // Resolve the target (replace) or judge the parent edge (create) before a single byte is written -- a bad
        // target/parent must store nothing. Then stream the bytes and, in either mode, persist the record as an
        // insert-or-resurrect pinned to the backend the bytes landed on.
        if('replaceNodeID' in metadata)
        {
            const { target, role } = await this.#prepareReplace(caller, metadata.replaceNodeID);
            const location = await this.#putBytes(ticket.sha256, ticket.size, body);
            const persist = this.#insertOrResurrect(ticket.sha256, ticket.size, location);

            return this.#commitReplace(
                target,
                role,
                ticket.sha256,
                ticket.size,
                metadata.mimeType,
                metadata.ifBlobID,
                persist
            );
        }

        await this.#assertParentEdge(caller.id, metadata.parentID);
        const location = await this.#putBytes(ticket.sha256, ticket.size, body);
        const persist = this.#insertOrResurrect(ticket.sha256, ticket.size, location);

        const node = await this.#commitFileNode(caller, ticket.sha256, ticket.size, metadata, persist);

        return { node, role: 'owner' };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Background maintenance
    //------------------------------------------------------------------------------------------------------------------

    // Prune expired tickets/challenges and stale failed-proof counts. Correctness never depends on this (expiry is
    // enforced on use); it only bounds memory. The composition root starts it; it returns a stop handle.
    startSweeps(intervalMs : number = SWEEP_INTERVAL_MS) : () => void
    {
        const timer = setInterval(() =>
        {
            this.#tickets.sweep();
            this.#challenges.sweep();
            this.#failedProofs.sweep();
        }, intervalMs);

        timer.unref?.();
        return () => clearInterval(timer);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Internals
    //------------------------------------------------------------------------------------------------------------------

    // The record write for an upload commit: insert the blob (or clear its graveyard marker) pinned to the backend the
    // bytes landed on. A proven dedup uses resurrect instead -- there are no fresh bytes, so the pin already stands.
    #insertOrResurrect(sha256 : string, size : number, location : BlobLocation) : (blob : BlobRA) => Promise<void>
    {
        return (blob) => blob.insertOrResurrect({
            sha256,
            size,
            backendID: location.backendID,
            storageKey: location.storageKey,
        });
    }

    async #admitQuota(caller : SessionUser, incomingBytes : number) : Promise<void>
    {
        const limitBytes = await this.#resolveLimit(caller.quotaLimit ?? null);
        const usedBytes = await this.#nodes.ownedBytes(caller.id);

        this.#enforceQuota(caller.id, usedBytes, incomingBytes, limitBytes);
    }

    // Fold the instance default into an owner's raw quota_limit. Always called BEFORE a transaction opens: it reads
    // the settings row, and SQLite serializes writes, so a read issued from inside an open write transaction on the
    // same handle deadlocks the commit. The resolved limit is then carried into the transaction as a plain number.
    async #resolveLimit(userLimit : number | null) : Promise<number | null>
    {
        return effectiveQuota(userLimit, await this.#defaultQuota());
    }

    // Judge one write against an owner's quota and throw the quota message on refusal. Keyed by ownerID and an already-
    // resolved limit so it serves both the caller-charged create paths (caller is the owner) and the owner-charged
    // replace path (an editor's write is charged to the file's owner, whose limit is read from their user row, not the
    // actor's session). usedBytes is passed in so the caller controls whether it was read outside the commit (the
    // early gate) or inside it (the authoritative re-check). incomingBytes is the DELTA for a replace, which may be
    // negative.
    #enforceQuota(ownerID : string, usedBytes : number, incomingBytes : number, limitBytes : number | null) : void
    {
        const verdict = regulation.quota.admit({ ownerID, usedBytes, limitBytes, incomingBytes });

        if(!verdict.ok)
        {
            throw new ForbiddenError(verdict.violations[0]?.message ?? 'This write would exceed the storage quota.');
        }
    }

    // Stream the body through the storage RA (onto the default backend), capping the byte count at the claimed size in
    // flight, and return the pin the record will store. Integrity failures the store raises become 400s with their
    // typed codes.
    async #putBytes(sha256 : string, size : number, body : Readable) : Promise<BlobLocation>
    {
        const limiter = byteLimiter(size);
        body.on('error', (error) => limiter.destroy(error));

        try
        {
            return await this.#blob.put(sha256, body.pipe(limiter), size);
        }
        catch(error)
        {
            if(error instanceof HashMismatchError)
            {
                throw new BadRequestError(`Uploaded bytes do not match the claimed hash (${ error.code }).`);
            }
            if(error instanceof SizeMismatchError)
            {
                throw new BadRequestError(`Uploaded byte count does not match the claimed size (${ error.code }).`);
            }
            throw error;
        }
    }

    // Parent-edge legality, decided by the shared regulation judge rather than a private rule, so the upload
    // and node-creation paths reject the same placements: a non-folder parent, a trashed parent, or a parent the caller
    // has no editor+ role on. The share resolver supplies the real role, so an editor on a folder shared to them may
    // upload into it -- the created file is owned by the uploader and charged to their quota.
    async #assertParentEdge(ownerID : string, parentID : string | null) : Promise<void>
    {
        const parent = await this.#gatherParent(parentID);

        const verdict = regulation.node.parentEdge({
            creatorID: ownerID,
            parent,
            creatorRoleOnParent: parent === null ? null : await this.#shares.effectiveRole(ownerID, parent.id),
        });

        if(!verdict.ok) { throw new RegulationError(verdict.violations); }
    }

    async #gatherParent(parentID : string | null) : Promise<Node | null>
    {
        if(parentID === null) { return null; }

        const parent = await this.#nodes.get(parentID);
        if(parent === undefined) { throw new NotFoundError(`No parent node ${ parentID }.`); }

        return parent;
    }

    // One transaction: persist the blob record (insert-or-resurrect for an upload, resurrect for a proven dedup) and
    // insert the file node, so the reference and any resurrection commit together. The tx-bound RA instances
    // share the transaction's executor; persistBlob is the record write the caller's path dictates.
    async #commitFileNode(
        caller : SessionUser,
        sha256 : string,
        size : number,
        metadata : UploadCommitCreate,
        persistBlob : (blob : BlobRA) => Promise<void>
    ) : Promise<FileNode>
    {
        const now = new Date();
        const node : FileNode = {
            type: 'file',
            id: createId(),
            name: metadata.name,
            ownerID: caller.id,
            parentID: metadata.parentID,
            blobID: sha256,
            size,
            mimeType: metadata.mimeType,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
        };

        const limitBytes = await this.#resolveLimit(caller.quotaLimit ?? null);

        await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const blob = new BlobRA(txHandle);
            const nodes = new NodeRA(txHandle);

            // Re-judge quota against usage read inside the transaction. The claim-time gate admits each claim in
            // isolation, so a batch of concurrent claims could jointly overshoot; this is the authoritative check. On
            // SQLite (serialized writes) it closes the window; on Postgres READ COMMITTED it narrows it to concurrent
            // uncommitted claims -- full serialization (row locks / SERIALIZABLE) is out of v1 scope.
            this.#enforceQuota(caller.id, await nodes.ownedBytes(caller.id), size, limitBytes);

            await persistBlob(blob);
            await nodes.insert(node);
        });

        return node;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Replace
    //------------------------------------------------------------------------------------------------------------------

    // Resolve a replace target as the caller sees it. The target must be a file the caller resolves with editor-or-
    // better: a target they cannot resolve (missing, no access, or trashed-and-not-theirs) reads as absent (404), and
    // a non-file or a viewer is the typed regulation rejection. A trashed file reads as absent to non-owners, but its
    // OWNER may replace their own trashed file (it stays trashed) -- the same read-as-absent doctrine copy applies.
    async #prepareReplace(caller : SessionUser, replaceNodeID : string) : Promise<{ target : FileNode; role : Role }>
    {
        const node = await this.#nodes.get(replaceNodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ replaceNodeID }.`); }

        const role = await this.#shares.effectiveRole(caller.id, node.id);
        if(role === null) { throw new NotFoundError(`No node ${ replaceNodeID }.`); }

        if(node.type !== 'link' && node.trashedAt !== null && !isDirectOwner(node, caller.id))
        {
            throw new NotFoundError(`No node ${ replaceNodeID }.`);
        }

        const verdict = regulation.node.replace({ target: node, actorRole: role });
        if(!verdict.ok) { throw new RegulationError(verdict.violations); }

        // Unreachable: judgeReplace rejects a non-file target above. The guard narrows the union so the commit reads
        // the file-only fields; a folder or link reaching here would mean the judge and this build disagree.
        if(node.type !== 'file') { throw new Error(`replace admitted a non-file target ${ node.id }`); }

        return { target: node, role };
    }

    // The optimistic-concurrency check behind ifBlobID: the node's blob must still be the one the caller edited from.
    // A vanished node, a non-file (both impossible under the schema, but they leave no blob to match), or a blob that
    // has moved on all mean another write won the race -- the caller must reload before retrying. Read fresh inside the
    // commit transaction so it is the authoritative current value, not the pre-upload snapshot.
    async #assertBlobUnchanged(nodes : NodeRA, nodeID : string, expectedBlobID : string) : Promise<void>
    {
        const current = await nodes.get(nodeID);

        if(current === undefined || current.type !== 'file' || current.blobID !== expectedBlobID)
        {
            throw new ConflictError('The file changed since you opened it. Reload to see the latest version.');
        }
    }

    // Repoint an existing file at new content in one transaction: persist the blob record (insert-or-resurrect for an
    // upload, resurrect for a proven dedup), move the node's blob/size/mime and bump updated_at, and graveyard the OLD
    // blob if this node was its last reference -- the sweep runs AFTER the repoint so its reference count reflects the
    // new state. Name, parent, owner, and trash state never change, so the node keeps its id and every link and share
    // pointing at it stays valid.
    //
    // Quota is charged to the OWNER, not the acting editor, so the delta (new size - old size; negative always admits)
    // is judged against the owner's usage and their limit from their user row. The claim-time gate charged the ACTOR
    // (the claim never knew the target); the in-transaction re-judge here is the authoritative one against the owner.
    async #commitReplace(
        target : FileNode,
        role : Role,
        sha256 : string,
        size : number,
        mimeType : string | undefined,
        ifBlobID : string | undefined,
        persistBlob : (blob : BlobRA) => Promise<void>
    ) : Promise<CommittedNode>
    {
        const oldBlobID = target.blobID;
        const delta = size - target.size;
        const resolvedMime = mimeType ?? target.mimeType;
        const ownerLimit = await this.#resolveLimit(await this.#users.quotaLimitOf(target.ownerID));
        const now = new Date();

        // Early gate against the owner's quota before a write is opened; the in-transaction re-judge below is
        // authoritative (see #commitFileNode). A negative delta always admits -- it only lowers usage.
        this.#enforceQuota(target.ownerID, await this.#nodes.ownedBytes(target.ownerID), delta, ownerLimit);

        await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const blob = new BlobRA(txHandle);
            const nodes = new NodeRA(txHandle);

            // Optimistic-concurrency guard, judged against the authoritative current row inside the transaction
            // (not the target snapshot taken before the bytes streamed): if the caller pinned the blob they edited
            // from and it has moved on since, someone else saved first -- refuse rather than clobber their edit.
            if(ifBlobID !== undefined) { await this.#assertBlobUnchanged(nodes, target.id, ifBlobID); }

            this.#enforceQuota(target.ownerID, await nodes.ownedBytes(target.ownerID), delta, ownerLimit);

            await persistBlob(blob);
            await nodes.replaceContent(target.id, sha256, size, resolvedMime, now);

            // Graveyard the old blob when this node was its last reference. Skipped when the content is unchanged (the
            // node now references the same sha, so the sweep would find it referenced and leave it live anyway).
            if(oldBlobID !== sha256) { await blob.graveyardUnreferenced([ oldBlobID ]); }
        });

        const node : FileNode = { ...target, blobID: sha256, size, mimeType: resolvedMime, updatedAt: now };

        return { node, role };
    }
}

//----------------------------------------------------------------------------------------------------------------------
