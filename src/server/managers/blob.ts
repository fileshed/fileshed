//----------------------------------------------------------------------------------------------------------------------
// Blob Manager
//
// A claim is admitted against the owner's quota -- what their files already hold plus what their outstanding claims
// have yet to deliver -- and then routed: an unknown blob gets a single-use upload ticket; a known blob (graveyarded or
// not) that is worth the round trip gets a proof-of-possession challenge instead of re-uploading the bytes. Answering a
// challenge or completing an upload creates the caller's file node -- for a known blob, resurrecting the record if it
// was graveyarded -- in one transaction.
//
// Upload bytes travel as one stream or as a sequence of chunks against the same ticket, which carries how far the
// upload has got between requests -- the chunk holding the last byte is the one that verifies and commits.
//
// Tickets, challenges, and the failed-proof counter are in-memory: a single-node deployment, and losing them on
// restart only forces a client to re-claim. A restart mid-upload therefore loses the partial: the client's retry
// starts the file over, and the abandoned staging bytes are swept. Expiry is enforced lazily on use (an expired entry
// is never honoured) and swept in the background to bound growth.
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
    MAX_OUTSTANDING_TICKETS,
    MIN_CHALLENGE_RANGES,
    NONCE_BYTES,
    type Node,
    type NodeResponse,
    NotFoundError,
    OffsetConflictError,
    PayloadTooLargeError,
    RegulationError,
    type Role,
    SMALL_FILE_THRESHOLD_BYTES,
    SizeMismatchError,
    TICKET_TTL_MS,
    TooManyRequestsError,
    type UploadChunkAccepted,
    type UploadCommitCreate,
    type UploadCommitMetadata,
    isHiddenTrash,
    isSkippedName,
} from '@fileshed/core';

// Engines
import { regulation } from '../engines/regulation/index.ts';

// Managers
import { NodeAdmission } from './nodeAdmission.ts';
import type { Actor } from './session.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';
import { type DatabaseHandle, inTransaction } from '../resource-access/database/database.ts';
import { type BlobLocation, BlobRA } from '../resource-access/blob/index.ts';
import { NodeRA } from '../resource-access/nodes/index.ts';
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
    expires : number;

    // How much of the claimed size has landed in staging. A whole-file PUT never touches it; a chunked upload advances
    // it as each chunk lands and finalizes on the chunk that carries it to `size`.
    receivedBytes : number;

    // A chunk is being written right now. Chunks are sequential by contract, so a second one arriving mid-write is
    // refused rather than interleaved into the staging file.
    inFlight : boolean;

    // The ticket has been handed to a commit and no more bytes will be taken against it. It stays in the store, and
    // stays counted against its owner, until that commit settles.
    spent : boolean;

    // What the commit answered, once it did. Verifying and hashing an assembled file is seconds of work on a large
    // one, and a connection torn in that window leaves the client retrying a commit that very likely stored its file.
    // A settled ticket answers that retry with the stored node, until the ticket expires.
    settled ?: CommittedNode;
}

// Upload tickets, and the position of any chunked upload running against them. A ticket is retired by the request that
// completes the file (or by the whole-file PUT, which is single-use as ever); the chunks before that leave it standing.
// An expired ticket is never honoured and is dropped on the way past.
//
// A ticket is also a hold on its owner's storage: it entitles the client to put its claimed size into staging, and
// nothing has charged the account for those bytes yet. So the store indexes tickets by owner, and `outstanding` is
// what the claim gate judges against alongside committed usage -- otherwise every concurrent claim is admitted in
// isolation against the same zero, and N of them each get the whole quota.
class TicketStore
{
    readonly #tickets = new Map<string, Ticket>();
    readonly #byOwner = new Map<string, Set<Ticket>>();

    issue(sha256 : string, size : number, ownerID : string) : Ticket
    {
        const ticket : Ticket = {
            id: createId(),
            sha256,
            size,
            ownerID,
            expires: Date.now() + TICKET_TTL_MS,
            receivedBytes: 0,
            inFlight: false,
            spent: false,
        };

        this.#tickets.set(ticket.id, ticket);
        this.#owned(ownerID).add(ticket);

        return ticket;
    }

    open(id : string) : Ticket | undefined
    {
        const ticket = this.#tickets.get(id);
        if(ticket === undefined) { return undefined; }

        if(ticket.expires <= Date.now())
        {
            this.#drop(ticket);
            return undefined;
        }

        return ticket;
    }

    // What this owner is holding right now: the uploads they have going, and the bytes those uploads claimed. Lapsed
    // entries are dropped on the way past, so an expired hold never counts against the next claim.
    outstanding(ownerID : string) : { count : number; bytes : number }
    {
        const now = Date.now();
        let count = 0;
        let bytes = 0;

        for(const ticket of this.#byOwner.get(ownerID) ?? [])
        {
            if(ticket.expires <= now)
            {
                this.#drop(ticket);
            }
            else if(ticket.settled === undefined)
            {
                count += 1;
                bytes += ticket.size;
            }
        }

        return { count, bytes };
    }

    // Hand the ticket to a commit. Single-use is enforced from here on -- a second request is refused with
    // upload.chunkInFlight until the commit settles -- while the hold on the owner survives until then too, so a client
    // cannot free its own claim by starting the upload and claiming again while the bytes are in flight.
    spend(ticket : Ticket) : void
    {
        ticket.spent = true;
    }

    // The commit answered. The ticket stays where it is, carrying that answer, so a retry whose own request died on
    // the way back is told the file is stored rather than told the ticket never existed. It lapses on the schedule it
    // always had.
    settle(ticket : Ticket, committed : CommittedNode) : void
    {
        ticket.settled = committed;
    }

    close(id : string) : void
    {
        const ticket = this.#tickets.get(id);
        if(ticket !== undefined) { this.#drop(ticket); }
    }

    // Move the upload forward and push the expiry out: an upload still delivering bytes is alive, however long the
    // whole file takes, and the staged-upload sweep reads the same window from the other side.
    //
    // Renewed by bytes landing, never by a request arriving. The staged-upload sweep reclaims staging that has sat
    // untouched for a whole ticket lifetime, on the rule that a live ticket always has fresh staging -- and a
    // zero-length append writes nothing, so it leaves the file's mtime where it was. Renewing on one would push the
    // ticket past its own staging, and a client repeating it every few minutes would outlive the bytes entirely.
    advance(ticket : Ticket, receivedBytes : number) : void
    {
        const landed = receivedBytes > ticket.receivedBytes;

        ticket.receivedBytes = receivedBytes;
        if(landed) { ticket.expires = Date.now() + TICKET_TTL_MS; }
    }

    sweep() : void
    {
        const now = Date.now();
        for(const ticket of this.#tickets.values())
        {
            if(ticket.expires <= now) { this.#drop(ticket); }
        }
    }

    #owned(ownerID : string) : Set<Ticket>
    {
        const owned = this.#byOwner.get(ownerID);
        if(owned !== undefined) { return owned; }

        const created = new Set<Ticket>();
        this.#byOwner.set(ownerID, created);

        return created;
    }

    // Both indexes, always together: an owner whose last ticket goes leaves no entry behind, so the index costs
    // nothing for the accounts that are not uploading right now.
    #drop(ticket : Ticket) : void
    {
        this.#tickets.delete(ticket.id);

        const owned = this.#byOwner.get(ticket.ownerID);
        if(owned === undefined) { return; }

        owned.delete(ticket);
        if(owned.size === 0) { this.#byOwner.delete(ticket.ownerID); }
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
    expires : number;
}

// Single-use proof-of-possession challenges. Same consume-once, expire-fast contract as tickets.
class ChallengeStore
{
    readonly #challenges = new Map<string, Challenge>();

    issue(init : Omit<Challenge, 'id' | 'expires'>) : Challenge
    {
        const challenge : Challenge = { ...init, id: createId(), expires: Date.now() + CHALLENGE_TTL_MS };
        this.#challenges.set(challenge.id, challenge);
        return challenge;
    }

    consume(id : string) : Challenge | undefined
    {
        const challenge = this.#challenges.get(id);
        if(challenge === undefined) { return undefined; }

        this.#challenges.delete(id);
        return challenge.expires > Date.now() ? challenge : undefined;
    }

    sweep() : void
    {
        const now = Date.now();
        for(const [ id, challenge ] of this.#challenges)
        {
            if(challenge.expires <= now) { this.#challenges.delete(id); }
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
async function buildProof(
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

// The store's integrity refusals are the client's fault -- bytes that disagree with what it claimed -- so they travel
// as 400s carrying the typed code. Anything else passes through untouched.
function asIntegrityRejection(error : unknown) : unknown
{
    if(error instanceof HashMismatchError)
    {
        return new BadRequestError(`Uploaded bytes do not match the claimed hash (${ error.code }).`);
    }

    if(error instanceof SizeMismatchError)
    {
        return new BadRequestError(`Uploaded byte count does not match the claimed size (${ error.code }).`);
    }

    return error;
}

// What both ifBlobID gates raise: the caller pinned the version they edited from and it is no longer the one on the
// node, so somebody else saved first and the caller must reload rather than clobber them.
function staleBlobConflict() : ConflictError
{
    return new ConflictError(
        'replace.staleBlob',
        'The file changed since you opened it. Reload to see the latest version.'
    );
}

// Caps the streamed byte count at what the claim still has room for while an upload is in flight: a client that
// streams more than it claimed is aborted at the first excess byte, which rejects the pipeline and cleans its staging
// file, so a size lie can never push gigabytes onto disk. Exceeding the claimed size is the same size mismatch the
// store would catch after the fact (400), so the limiter raises it as one.
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

// An upload body behind its byte cap, with both ends torn down together: a failed body kills the limiter, and a
// limiter that cut a lying client off kills the body, so neither is left writing into a stream that is already gone.
function capped(body : Readable, maxBytes : number) : Readable
{
    const limiter = byteLimiter(maxBytes);

    body.on('error', (error) => limiter.destroy(error));
    limiter.on('error', () => body.destroy());

    return body.pipe(limiter);
}

//----------------------------------------------------------------------------------------------------------------------

export interface BlobManagerDeps
{
    handle : DatabaseHandle;
    blob : BlobRA;

    // Read at use time, per request, so an admin raising or lowering the cap needs no restart.
    uploadMaxBytes : () => Promise<number>;

    // The filenames this instance refuses to store, read at use time for the same reason.
    skippedUploadNames : () => Promise<string[]>;

    // The size a client cuts a file into, handed back with every upload ticket. A plain number, not a supplier: it is
    // fixed at boot by the environment, and a client already mid-upload plans against the value its claim answered.
    uploadChunkBytes : number;

    // The instance-wide quota every account with no limit of its own inherits, likewise read per use.
    defaultQuota : () => Promise<number>;

    // What a commit answers with and sets going: the node manager's single-node response, and tag extraction.
    responder : NodeResponder;
    tags : TagEnricher;
}

export interface NodeResponder
{
    respond(actor : Actor, node : Node, role : Role) : Promise<NodeResponse>;
}

export interface TagEnricher
{
    enrichInBackground(blobID : string, mimeType : string | null) : void;
}

// A committed file node with the caller's effective role on it, so the response carries the real role rather than
// assuming ownership: a create is always the caller's own ('owner'), but a replace may be run by an editor on a file
// shared to them, whose response must carry 'editor'.
interface CommittedNode
{
    node : FileNode;
    role : Role;
}

// What a chunk that landed without completing the file leaves behind: the upload's new position. The two outcomes of
// an upload request are told apart by `committed`, so a caller cannot read a node off a request that never made one.
export interface UploadAccepted extends UploadChunkAccepted
{
    committed : false;
}

export interface UploadCommitted
{
    committed : true;
    node : NodeResponse;
}

export type UploadOutcome = UploadAccepted | UploadCommitted;

// The same two outcomes before the committed node is answered for.
type ReceivedCommit = CommittedNode & { committed : true };
type ReceivedUpload = UploadAccepted | ReceivedCommit;

// What one upload request carries: its bytes, the length it declared (undefined when it declared none), and where in
// the claimed file the first of those bytes belongs.
export interface UploadBytes
{
    stream : Readable;
    contentLength : number | undefined;
    offset : number;
}

//----------------------------------------------------------------------------------------------------------------------

export class BlobManager
{
    readonly #handle : DatabaseHandle;
    readonly #blob : BlobRA;
    readonly #uploadMaxBytes : () => Promise<number>;
    readonly #skippedUploadNames : () => Promise<string[]>;
    readonly #uploadChunkBytes : number;
    readonly #responder : NodeResponder;
    readonly #tags : TagEnricher;

    readonly #nodes : NodeRA;
    readonly #shares : ShareRA;
    readonly #admission : NodeAdmission;

    readonly #tickets = new TicketStore();
    readonly #challenges = new ChallengeStore();
    readonly #failedProofs = new FailedProofTracker();

    readonly #logger = getLogger('blob');

    constructor(deps : BlobManagerDeps)
    {
        this.#handle = deps.handle;
        this.#blob = deps.blob;
        this.#uploadMaxBytes = deps.uploadMaxBytes;
        this.#skippedUploadNames = deps.skippedUploadNames;
        this.#uploadChunkBytes = deps.uploadChunkBytes;
        this.#responder = deps.responder;
        this.#tags = deps.tags;

        this.#nodes = new NodeRA(deps.handle);
        this.#shares = new ShareRA(deps.handle);
        this.#admission = new NodeAdmission({
            nodes: this.#nodes,
            shares: this.#shares,
            users: new UserRA(deps.handle),
            defaultQuota: deps.defaultQuota,
        });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Claim
    //------------------------------------------------------------------------------------------------------------------

    // POST /api/blobs/claim. The blob is resolved first so quota and the ticket/challenge routing decide against the
    // authoritative size, not a size the client invented: unknown -> upload ticket; known and large ->
    // proof-of-possession challenge; known but small -> ticket (round trips cost more than the bytes).
    async claim(user : SessionUser, request : ClaimRequest) : Promise<ClaimResponse>
    {
        const stored = await this.#blob.get(request.sha256);

        // Content-addressed: a known sha256 has exactly one size, so a claim naming another one is not describing what
        // this instance holds and is answered as if the content were new. Refusing it distinctly would tell anyone who
        // names a hash whether the instance holds that content, in one request and without knowing its size -- and the
        // answer is worth nothing to a caller who does possess the bytes, since they know the size.
        //
        // Routing the lie as new content costs nothing: the claimed size is what quota admits and what the ticket
        // allows into staging, and the store verifies both hash and size against the bytes. So under-reporting to slip
        // past quota, or to route a large blob into the ticket path and skip the proof, buys an upload that cannot
        // commit -- the bytes never hash to the claimed address at the claimed length.
        const known = stored !== undefined && stored.size === request.size ? stored : undefined;

        const size = known?.size ?? request.size;

        // Everything the admission decision needs is resolved before it starts, because from the judgement to the
        // ticket that records the hold there must be no await: two claims arriving together would otherwise be judged
        // against the same outstanding total and both admitted, and one quota would have covered them twice.
        const [ limitBytes, usedBytes, maxBytes ] = await Promise.all([
            this.#admission.resolveLimit(user.id),
            this.#nodes.ownedBytes(user.id),
            this.#uploadMaxBytes(),
        ]);

        const outstanding = this.#tickets.outstanding(user.id);

        this.#admission.enforceQuota(user.id, usedBytes + outstanding.bytes, size, limitBytes);

        if(known === undefined)
        {
            if(size > maxBytes)
            {
                throw new PayloadTooLargeError('File exceeds the maximum upload size.', maxBytes);
            }
            return this.#ticketFor(request.sha256, size, user.id, outstanding.count);
        }

        if(size < SMALL_FILE_THRESHOLD_BYTES)
        {
            return this.#ticketFor(request.sha256, size, user.id, outstanding.count);
        }

        const nonce = randomBytes(NONCE_BYTES).toString('hex');
        const ranges = randomRanges(size);
        const challenge = this.#challenges.issue({
            sha256: request.sha256,
            size,
            ownerID: user.id,
            nonce,
            ranges,
            location: known,
        });

        return { upload: false, challengeID: challenge.id, nonce, ranges };
    }

    // A fresh ticket and the chunk size to deliver against it. Both halves of what a client needs to start moving
    // bytes, so neither branch of the claim can hand back one without the other.
    //
    // An account already holding the maximum is refused here rather than at the bytes: a claim costs the client one
    // cheap request and costs the server a live entry for the ticket's whole lifetime, so the count is capped
    // independently of the quota that bounds what those tickets may write.
    #ticketFor(sha256 : string, size : number, ownerID : string, outstandingCount : number) : ClaimResponse
    {
        if(outstandingCount >= MAX_OUTSTANDING_TICKETS)
        {
            throw new TooManyRequestsError(
                'Too many uploads in progress; finish or abandon one before starting another.'
            );
        }

        return {
            upload: true,
            ticket: this.#tickets.issue(sha256, size, ownerID).id,
            chunkBytes: this.#uploadChunkBytes,
        };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Proof-of-possession answer
    //------------------------------------------------------------------------------------------------------------------

    // POST /api/blobs/claim/:challengeID. Recompute the proof over the challenge's ranges, compare in constant time,
    // and on success commit (resurrecting a graveyarded blob) with zero bytes moved -- creating the caller's node, or
    // replacing an existing file's content in place. A failed proof is logged and counted toward the per-user rate
    // limit (a failure is probing), and is gated ahead of the target resolution so a probe learns nothing about it.
    async answerChallenge(actor : Actor, challengeID : string, answer : string, metadata : UploadCommitMetadata)
    : Promise<NodeResponse>
    {
        return this.#respond(actor, await this.#proveAndCommit(actor.user, challengeID, answer, metadata));
    }

    async #proveAndCommit(user : SessionUser, challengeID : string, answer : string, metadata : UploadCommitMetadata)
    : Promise<CommittedNode>
    {
        if(this.#failedProofs.isLimited(user.id))
        {
            throw new TooManyRequestsError('Too many failed proofs; try again later.');
        }

        const challenge = this.#challenges.consume(challengeID);
        if(challenge === undefined) { throw new NotFoundError('Challenge not found or expired.'); }
        if(challenge.ownerID !== user.id) { throw new ForbiddenError('This challenge belongs to another user.'); }

        let expected : string;
        try
        {
            expected = await buildProof(this.#blob, challenge.location, challenge.ranges, challenge.nonce);
        }
        catch(error)
        {
            // The bytes vanished under the challenge -- GC hard-deleted them inside the window. That is a server-side
            // race, not the client probing a hash it lacks, so it is NOT counted toward the failed-proof rate limit.
            // The blob is simply gone; the client must re-claim.
            if(error instanceof BlobNotFoundError)
            {
                this.#logger.info({ userID: user.id, sha256: challenge.sha256 }, 'Challenge blob vanished mid-proof');
                throw new NotFoundError('The blob is no longer available; re-claim to upload.');
            }
            throw error;
        }

        if(!proofMatches(expected, answer))
        {
            this.#failedProofs.record(user.id);
            this.#logger.warn({ userID: user.id, sha256: challenge.sha256 }, 'Failed proof-of-possession');
            throw new ForbiddenError('Proof of possession failed.');
        }

        await this.#assertNameAccepted(metadata);

        // Known blob: the record already exists, so persistBlob only clears its graveyard marker. If GC hard-deleted
        // the record in the challenge window, resurrect touches nothing and the write fails the blob_id FK.
        const persistBlob = (blob : BlobRA) : Promise<void> => blob.resurrect(challenge.sha256);

        if('replaceNodeID' in metadata)
        {
            const { target, role } = await this.#prepareReplace(user, metadata.replaceNodeID);
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

        await this.#assertParentEdge(user.id, metadata.parentID);
        const node = await this.#commitFileNode(user, challenge.sha256, challenge.size, metadata, persistBlob);

        return { node, role: 'owner' };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Upload commit
    //------------------------------------------------------------------------------------------------------------------

    // PUT /api/uploads/:ticket. The body is the whole file or one chunk of it, `offset` says where in the file those
    // bytes belong, and the ticket carries the position between requests -- so an upload survives any proxy's
    // request-body cap by never putting the whole file in one request.
    //
    // A request that declares the whole claimed size at offset 0 streams straight through the store (which verifies
    // hash + size and rejects a liar) and retires its single-use ticket, exactly as an unchunked upload always has.
    // Anything else appends to the ticket's staging area and answers the new position; the chunk that carries the last
    // byte verifies the assembled file and commits it. Only that final chunk retires the ticket, so a chunk that fails
    // in flight is retried alone rather than restarting the upload.
    async commitUpload(
        actor : Actor,
        ticketID : string,
        bytes : UploadBytes,
        metadata : UploadCommitMetadata
    ) : Promise<UploadOutcome>
    {
        const received = await this.#receive(actor.user, ticketID, bytes, metadata);
        if(!received.committed) { return received; }

        return { committed: true, node: await this.#respond(actor, received) };
    }

    // A dedup claim usually lands on an already-extracted blob; ensureFor's existence check makes the extraction a
    // no-op then, and covers the first-claim-after-resurrection case when it is not.
    async #respond(actor : Actor, committed : CommittedNode) : Promise<NodeResponse>
    {
        this.#tags.enrichInBackground(committed.node.blobID, committed.node.mimeType);

        return this.#responder.respond(actor, committed.node, committed.role);
    }

    async #receive(
        user : SessionUser,
        ticketID : string,
        bytes : UploadBytes,
        metadata : UploadCommitMetadata
    ) : Promise<ReceivedUpload>
    {
        const ticket = this.#tickets.open(ticketID);
        if(ticket === undefined) { throw new NotFoundError('Upload ticket not found or expired.'); }
        if(ticket.ownerID !== user.id) { throw new ForbiddenError('This ticket belongs to another user.'); }

        // Read live, so an admin lowering the cap stops an upload already in flight against the old one. Both reads
        // come before the ticket's state is judged: nothing may await between that judgement and the spend (or the
        // in-flight mark) that records it, or a second request arriving in the gap passes the same checks.
        const maxBytes = await this.#uploadMaxBytes();
        await this.#assertNameAccepted(metadata);

        // The bytes are already stored. Answering with the node rather than reading the body makes the retry of a
        // request whose reply never arrived land on the same file instead of a refusal.
        if(ticket.settled !== undefined) { return { committed: true, ...ticket.settled }; }

        // Handed to a commit that has not answered yet. The transient code is the one the client already backs off
        // and retries on, which is exactly the right thing to do while a large file is being verified.
        if(ticket.spent)
        {
            throw new ConflictError('upload.chunkInFlight', 'This upload is being committed.');
        }

        if(ticket.size > maxBytes)
        {
            throw new PayloadTooLargeError('Upload exceeds the maximum allowed size.', maxBytes);
        }

        if(bytes.offset === 0 && bytes.contentLength === ticket.size)
        {
            // A chunk still appending to staging would go on to commit the same ticket a second time.
            if(ticket.inFlight)
            {
                throw new ConflictError(
                    'upload.chunkInFlight',
                    'Another chunk of this upload is still being received.'
                );
            }

            return this.#commitTicket(
                user,
                ticket,
                metadata,
                () => this.#putBytes(ticket.sha256, ticket.size, bytes.stream)
            );
        }

        return this.#acceptChunk(user, ticket, bytes, metadata);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Chunks
    //------------------------------------------------------------------------------------------------------------------

    // One chunk of a file, appended to the ticket's staging area. The client and the server must agree on where the
    // upload stands before any bytes are written: a chunk that repeats ground already covered, or skips ahead of it, is
    // refused with the position it should have carried rather than silently corrupting the file. The chunk that brings
    // the staged bytes up to the claimed size verifies and commits them.
    async #acceptChunk(
        user : SessionUser,
        ticket : Ticket,
        bytes : UploadBytes,
        metadata : UploadCommitMetadata
    ) : Promise<ReceivedUpload>
    {
        const { stream, contentLength, offset } = bytes;

        this.#assertChunkFits(ticket, contentLength, offset);

        // Two appends to one staging file would interleave their bytes. The refusal carries the transient code: the
        // usual cause is a torn chunk retried before its own dead request finished unwinding, and it clears on its own.
        if(ticket.inFlight)
        {
            throw new ConflictError('upload.chunkInFlight', 'Another chunk of this upload is still being received.');
        }

        ticket.inFlight = true;
        try
        {
            // A refusal from the store means staging no longer matches what the ticket claims. The ticket is
            // corrected to what actually survived before the refusal travels, so a retry meets a position the
            // upload can be resumed from rather than the one that just failed.
            let written : number;
            try { written = await this.#appendChunk(ticket, stream, offset); }
            catch(error)
            {
                if(error instanceof OffsetConflictError) { this.#tickets.advance(ticket, error.receivedBytes); }

                throw error;
            }

            this.#tickets.advance(ticket, offset + written);

            if(ticket.receivedBytes < ticket.size)
            {
                return { committed: false, receivedBytes: ticket.receivedBytes, totalBytes: ticket.size };
            }

            // The file is whole, and its staging is spent whichever way the commit goes.
            try { return await this.#commitTicket(user, ticket, metadata, () => this.#publishStaged(ticket)); }
            finally { await this.#blob.discardStaged(ticket.id); }
        }
        finally
        {
            ticket.inFlight = false;
        }
    }

    // Spend the ticket on one commit: settle it with the answer, or close it when the commit fails. A failed commit
    // leaves no bytes to resume from, and the claim that restarts the upload is a round trip the client already knows
    // how to make. The ticket's hold on the owner outlives the ticket itself, right up to the commit settling.
    async #commitTicket(
        user : SessionUser,
        ticket : Ticket,
        metadata : UploadCommitMetadata,
        putBytes : () => Promise<BlobLocation>
    ) : Promise<ReceivedCommit>
    {
        this.#tickets.spend(ticket);

        try
        {
            const committed = await this.#commitContent(user, ticket, metadata, putBytes);
            this.#tickets.settle(ticket, committed);

            return { committed: true, ...committed };
        }
        catch(error)
        {
            this.#tickets.close(ticket.id);
            throw error;
        }
    }

    // The instance's junk list, applied where a name first binds to a node. A claim carries a hash and a size and no
    // name at all, so this is the first point the server sees one -- and the last, which is what makes it the place
    // an API client is held to the same list the browser applies before it hashes a byte.
    async #assertNameAccepted(metadata : UploadCommitMetadata) : Promise<void>
    {
        if('replaceNodeID' in metadata) { return; }

        const skipped = await this.#skippedUploadNames();
        if(!isSkippedName(metadata.name, skipped)) { return; }

        throw new BadRequestError(`This instance does not store files named '${ metadata.name }'.`);
    }

    // Where this chunk claims to belong, judged against where the upload actually stands. Every rejection here happens
    // before a byte is read, so a confused client never moves the upload.
    #assertChunkFits(ticket : Ticket, contentLength : number | undefined, offset : number) : void
    {
        if(offset > ticket.size)
        {
            throw new BadRequestError('The chunk offset is past the end of the claimed file.');
        }

        if(offset < ticket.receivedBytes)
        {
            throw new OffsetConflictError(
                `This chunk was already received; the upload holds ${ ticket.receivedBytes } of ${ ticket.size }`
                    + ' bytes.',
                ticket.receivedBytes
            );
        }

        if(offset > ticket.receivedBytes)
        {
            throw new OffsetConflictError(
                `The chunk starts at ${ offset }, but the upload holds ${ ticket.receivedBytes } bytes.`,
                ticket.receivedBytes
            );
        }

        if(contentLength !== undefined && offset + contentLength > ticket.size)
        {
            throw new BadRequestError('The chunk would carry the upload past the claimed size.');
        }
    }

    // Append the chunk's bytes to staging, capped at what the claim has room for so a client that streams more than it
    // declared is cut off at the first excess byte rather than growing the staging file without bound. A failed append
    // leaves the ticket's position untouched; the retry truncates whatever landed and writes the chunk again.
    async #appendChunk(ticket : Ticket, body : Readable, offset : number) : Promise<number>
    {
        return this.#blob.appendChunk(ticket.id, capped(body, ticket.size - offset), offset);
    }

    // Verify the assembled staging file against the claim and publish it, answering the pin the record will store.
    async #publishStaged(ticket : Ticket) : Promise<BlobLocation>
    {
        try
        {
            return await this.#blob.commitStaged(ticket.id, ticket.sha256, ticket.size);
        }
        catch(error)
        {
            throw asIntegrityRejection(error);
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Background maintenance
    //------------------------------------------------------------------------------------------------------------------

    // Prune expired tickets, challenges, and stale failed-proof counts. Correctness never depends on this -- an expired
    // entry is refused on use whether it has been pruned or not -- it bounds what the process holds in memory. The
    // staging bytes an expired ticket leaves on disk are the staged-upload sweep's to reclaim, on its own registered
    // timer.
    pruneExpired() : void
    {
        this.#tickets.sweep();
        this.#challenges.sweep();
        this.#failedProofs.sweep();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Internals
    //------------------------------------------------------------------------------------------------------------------

    // The record write for an upload commit: insert the blob (or clear its graveyard marker) pinned to the backend the
    // bytes landed on. A proven dedup uses resurrect instead -- there are no fresh bytes, so the pin already stands.
    #insertOrResurrect(sha256 : string, size : number, location : BlobLocation) : (blob : BlobRA) => Promise<void>
    {
        return (blob) => blob.insertOrResurrect({ sha256, size, ...location });
    }

    // Commit an upload's bytes as the caller's file node, or onto an existing one. Every refusal that can be reached
    // without the bytes is reached BEFORE `putBytes` publishes anything -- a bad target, an illegal parent, a target
    // another writer has already moved on -- and the record write that follows is an insert-or-resurrect pinned to the
    // backend the bytes landed on.
    async #commitContent(
        user : SessionUser,
        ticket : Ticket,
        metadata : UploadCommitMetadata,
        putBytes : () => Promise<BlobLocation>
    ) : Promise<CommittedNode>
    {
        const { sha256, size } = ticket;

        if('replaceNodeID' in metadata)
        {
            const { target, role } = await this.#prepareReplace(user, metadata.replaceNodeID);

            // The stale-edit refusal, judged twice: here against the target as it was resolved, so a caller editing
            // from a version somebody else has already replaced never publishes bytes at all, and again inside the
            // commit transaction, where it is authoritative against a row that may have moved while these streamed.
            if(metadata.ifBlobID !== undefined && target.blobID !== metadata.ifBlobID) { throw staleBlobConflict(); }

            const persist = this.#insertOrResurrect(sha256, size, await putBytes());

            return this.#commitReplace(target, role, sha256, size, metadata.mimeType, metadata.ifBlobID, persist);
        }

        await this.#assertParentEdge(user.id, metadata.parentID);
        const persist = this.#insertOrResurrect(sha256, size, await putBytes());

        return { node: await this.#commitFileNode(user, sha256, size, metadata, persist), role: 'owner' };
    }

    // Stream the body through the storage RA (onto the default backend), capping the byte count at the claimed size in
    // flight, and return the pin the record will store. Integrity failures the store raises become 400s with their
    // typed codes.
    async #putBytes(sha256 : string, size : number, body : Readable) : Promise<BlobLocation>
    {
        try
        {
            return await this.#blob.put(sha256, capped(body, size), size);
        }
        catch(error)
        {
            throw asIntegrityRejection(error);
        }
    }

    // The parent-edge judgement node creation applies, so an upload is refused the same parents: a non-folder, a
    // trashed one, or one the caller has no editor+ role on. The share resolver supplies the real role, so an editor on
    // a folder shared to them may upload into it -- the created file is owned by the uploader and charged to their
    // quota. Depth is not judged: placement stops folders one rung short of the walk bound precisely so the deepest
    // one can still hold a file.
    async #assertParentEdge(ownerID : string, parentID : string | null) : Promise<void>
    {
        const parent = await this.#admission.gatherParent(parentID);
        const verdict = await this.#admission.judgeParentEdge(ownerID, parent);

        if(!verdict.ok) { throw new RegulationError(verdict.violations); }
    }

    // One transaction: persist the blob record (insert-or-resurrect for an upload, resurrect for a proven dedup) and
    // insert the file node, so the reference and any resurrection commit together. persistBlob is the record write the
    // caller's path dictates, made through the transaction's BlobRA.
    async #commitFileNode(
        user : SessionUser,
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
            ownerID: user.id,
            parentID: metadata.parentID,
            blobID: sha256,
            size,
            mimeType: metadata.mimeType,
            created: now,
            updated: now,
            trashed: null,
        };

        const limitBytes = await this.#admission.resolveLimit(user.id);

        await inTransaction(this.#handle, async (tx) =>
        {
            const blob = new BlobRA(tx);
            const nodes = new NodeRA(tx);

            // Re-judge quota against usage read inside the transaction. The claim-time gate admits each claim in
            // isolation, so a batch of concurrent claims could jointly overshoot; this is the authoritative check. On
            // SQLite (serialized writes) it closes the window; on Postgres READ COMMITTED it narrows it to concurrent
            // uncommitted claims -- full serialization (row locks / SERIALIZABLE) is out of v1 scope.
            this.#admission.enforceQuota(user.id, await nodes.ownedBytes(user.id), size, limitBytes);

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
    async #prepareReplace(user : SessionUser, replaceNodeID : string) : Promise<{ target : FileNode; role : Role }>
    {
        const node = await this.#nodes.get(replaceNodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ replaceNodeID }.`); }

        const role = await this.#shares.effectiveRole(user.id, node.id);
        if(role === null) { throw new NotFoundError(`No node ${ replaceNodeID }.`); }

        if(isHiddenTrash(node, user.id))
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
            throw staleBlobConflict();
        }
    }

    // Repoint an existing file at new content in one transaction: persist the blob record (insert-or-resurrect for an
    // upload, resurrect for a proven dedup), move the node's blob/size/mime and bump updated, and graveyard the OLD
    // blob if this node was its last reference -- the sweep runs AFTER the repoint so its reference count reflects the
    // new state. Name, parent, owner, and trash state never change, so the node keeps its id and every link and share
    // pointing at it stays valid.
    //
    // Quota is charged to the OWNER, not the acting editor, so the delta (new size - old size, possibly negative) is
    // judged against the owner's usage and their limit from their user row. The claim-time gate charged the ACTOR
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
        const ownerLimit = await this.#admission.resolveLimit(target.ownerID);
        const now = new Date();

        // Early gate against the owner's quota before a write is opened; the in-transaction re-judge below is
        // authoritative (see #commitFileNode). A negative delta admits whenever the usage it leaves fits the limit,
        // so an owner an admin left over a lowered limit stays refused until a shrink brings them back under it.
        this.#admission.enforceQuota(target.ownerID, await this.#nodes.ownedBytes(target.ownerID), delta, ownerLimit);

        await inTransaction(this.#handle, async (tx) =>
        {
            const blob = new BlobRA(tx);
            const nodes = new NodeRA(tx);

            // Optimistic-concurrency guard, judged against the authoritative current row inside the transaction
            // (not the target snapshot taken before the bytes streamed): if the caller pinned the blob they edited
            // from and it has moved on since, someone else saved first -- refuse rather than clobber their edit.
            if(ifBlobID !== undefined) { await this.#assertBlobUnchanged(nodes, target.id, ifBlobID); }

            this.#admission.enforceQuota(target.ownerID, await nodes.ownedBytes(target.ownerID), delta, ownerLimit);

            await persistBlob(blob);
            await nodes.replaceContent(target.id, sha256, size, resolvedMime, now);

            // Graveyard the old blob when this node was its last reference. Skipped when the content is unchanged (the
            // node now references the same sha, so the sweep would find it referenced and leave it live anyway).
            if(oldBlobID !== sha256) { await blob.graveyardUnreferenced([ oldBlobID ]); }
        });

        const node : FileNode = { ...target, blobID: sha256, size, mimeType: resolvedMime, updated: now };

        return { node, role };
    }
}

//----------------------------------------------------------------------------------------------------------------------
