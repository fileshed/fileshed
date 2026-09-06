//----------------------------------------------------------------------------------------------------------------------
// E2E — Upload, proof-of-possession dedup, and quota
//
// The claim/PoP/upload story driven over real sockets and asserted against real state: user
// A claims an unknown blob, gets a ticket, and PUTs the bytes; the database shows the blob pinned to the default fs
// backend and A's file node under a folder A owns; the sharded store holds bytes that hash back to the claimed sha; A's
// quota grows by the logical size. Then user B claims the same (now known, >1 MiB) blob, is challenged, computes the
// HMAC proof from the local bytes, and dedups: one blob row, two file nodes, and -- dedup being invisible to quotas
// -- both owners charged the full size.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    type ClaimResponse,
    MAX_FAILED_PROOFS,
    type MeResponse,
    type NodeListResponse,
    type NodeResponse,
} from '@fileshed/core';

// Support
import {
    ApiClient,
    type ServerHandle,
    blobFileExists,
    computeAnswer,
    largeFixture,
    readBlobFile,
    sha256Of,
    smallFixture,
    spawnServer,
    withDb,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

let server : ServerHandle;

let alice : ApiClient;
let bob : ApiClient;
let aliceID : string;
let bobID : string;
let folderID : string;

const data = largeFixture();
const sha = sha256Of(data);

let claimIssuedTicket : boolean;
let putStatus : number;
let fileNode : NodeResponse;

async function callerID(client : ApiClient) : Promise<string>
{
    const me = await (await client.get('/api/me')).json() as MeResponse;
    return me.id;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer();

    alice = new ApiClient(server.baseURL);
    await alice.signUp('alice@example.com', PASSWORD);
    aliceID = await callerID(alice);

    const folder = await (await alice.post('/api/nodes', { type: 'folder', name: 'uploads', parentID: null }))
        .json() as NodeResponse;
    folderID = folder.id;

    const claim = await (await alice.post('/api/blobs/claim', { sha256: sha, size: data.length }))
        .json() as ClaimResponse;
    claimIssuedTicket = claim.upload;
    if(claim.upload !== true) { throw new Error('setup: expected an upload ticket for an unknown blob'); }

    const query = new URLSearchParams({
        name: 'fixture.bin',
        parentID: folderID,
        mimeType: 'application/octet-stream',
    });
    const put = await alice.put(`/api/uploads/${ claim.ticket }?${ query.toString() }`, data);
    putStatus = put.status;
    fileNode = await put.json() as NodeResponse;

    bob = new ApiClient(server.baseURL);
    await bob.signUp('bob@example.com', PASSWORD);
    bobID = await callerID(bob);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------
// A fresh upload (unknown blob)
//----------------------------------------------------------------------------------------------------------------------

describe('fresh upload by the first owner', () =>
{
    it('issues an upload ticket for the unknown blob and commits the owner file node on PUT', () =>
    {
        expect(claimIssuedTicket).toBe(true);
        expect(putStatus).toBe(200);

        expect(fileNode.type).toBe('file');
        if(fileNode.type !== 'file') { throw new Error('expected a file node'); }

        expect(fileNode.ownerID).toBe(aliceID);
        expect(fileNode.parentID).toBe(folderID);
        expect(fileNode.name).toBe('fixture.bin');
        expect(fileNode.size).toBe(data.length);
        expect(fileNode.blobID).toBe(sha);
        expect(fileNode.role).toBe('owner');
    });

    it('records the blob pinned to the default fs backend at the claimed size', async () =>
    {
        const blob = await withDb(server, (db) => db
            .selectFrom('blob')
            .selectAll()
            .where('sha256', '=', sha)
            .executeTakeFirst());

        const backend = await withDb(server, (db) => db
            .selectFrom('storage_backend')
            .select('id')
            .where('kind', '=', 'fs')
            .executeTakeFirstOrThrow());

        expect(blob).toBeDefined();
        expect(blob?.size).toBe(data.length);
        expect(blob?.storage_key).toBe(sha);
        expect(blob?.backend_id).toBe(backend.id);
        expect(blob?.deleted_at).toBeNull();
    });

    it('owns exactly one file node and surfaces it in the folder listing with the owner role', async () =>
    {
        const owners = await withDb(server, (db) => db
            .selectFrom('node')
            .select('owner_id')
            .where('blob_id', '=', sha)
            .where('type', '=', 'file')
            .execute());
        expect(owners.map((row) => row.owner_id)).toEqual([ aliceID ]);

        const listing = await (await alice.get(`/api/nodes/${ folderID }/children`)).json() as NodeListResponse;
        const child = listing.nodes.find((node) => node.id === fileNode.id);

        expect(child?.type).toBe('file');
        if(child?.type !== 'file') { throw new Error('expected the uploaded file in the folder listing'); }
        expect(child.name).toBe('fixture.bin');
        expect(child.size).toBe(data.length);
        expect(child.role).toBe('owner');
    });

    it('lands the exact bytes in the sharded blob store', async () =>
    {
        expect(await blobFileExists(server.storageRoot, sha)).toBe(true);

        const stored = await readBlobFile(server.storageRoot, sha);
        expect(sha256Of(stored)).toBe(sha);
        expect(stored.equals(data)).toBe(true);
    });

    it('charges the uploader quota for the logical size', async () =>
    {
        const me = await (await alice.get('/api/me')).json() as MeResponse;

        expect(me.quota.used).toBe(data.length);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Proof-of-possession dedup (known blob; quota invisible to dedup)
//----------------------------------------------------------------------------------------------------------------------

describe('proof-of-possession dedup by a second owner', () =>
{
    it('challenges the second claimant, dedups on a correct proof, and charges both owners', async () =>
    {
        const challenge = await (await bob.post('/api/blobs/claim', { sha256: sha, size: data.length }))
            .json() as ClaimResponse;

        expect(challenge.upload).toBe(false);
        if(challenge.upload !== false) { throw new Error('expected a proof-of-possession challenge'); }

        // Structural assertion for randomized output: 2-4 ranges, each in-bounds. Never assert exact offsets/lengths --
        // fixed ranges would be harvest-and-replay-able, the exact property the challenge exists to defeat.
        expect(challenge.challengeID.length).toBeGreaterThan(0);
        expect(challenge.nonce.length).toBeGreaterThan(0);
        expect(challenge.ranges.length).toBeGreaterThanOrEqual(2);
        expect(challenge.ranges.length).toBeLessThanOrEqual(4);
        for(const [ offset, length ] of challenge.ranges)
        {
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(length).toBeGreaterThanOrEqual(1);
            expect(offset + length).toBeLessThanOrEqual(data.length);
        }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, data);
        const res = await bob.post(`/api/blobs/claim/${ challenge.challengeID }`, {
            answer,
            name: 'fixture-copy.bin',
            parentID: null,
            mimeType: 'application/octet-stream',
        });
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        expect(node.type).toBe('file');
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.ownerID).toBe(bobID);
        expect(node.blobID).toBe(sha);
        expect(node.role).toBe('owner');

        // One blob row, now referenced by two file nodes -- the dedup: zero bytes moved for B's copy.
        const blobRows = await withDb(server, (db) => db
            .selectFrom('blob')
            .select('sha256')
            .where('sha256', '=', sha)
            .execute());
        expect(blobRows).toHaveLength(1);

        const owners = await withDb(server, (db) => db
            .selectFrom('node')
            .select('owner_id')
            .where('blob_id', '=', sha)
            .where('type', '=', 'file')
            .execute());
        expect(owners.map((row) => row.owner_id).sort()).toEqual([ aliceID, bobID ].sort());

        // Dedup is invisible to quotas: each owner is charged the full logical size.
        const aliceUsed = (await (await alice.get('/api/me')).json() as MeResponse).quota.used;
        const bobUsed = (await (await bob.get('/api/me')).json() as MeResponse).quota.used;
        expect(aliceUsed).toBe(data.length);
        expect(bobUsed).toBe(data.length);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Quota enforcement at claim time
//
// A dedicated server whose quota is set by the bootstrap admin. A claim that would push usage over the limit is
// refused at claim time -- no ticket, no blob, no node -- while a claim that lands exactly at the limit is admitted
// and commits. The last case moves the quota out from under an already-signed-in user, which is where a cap read from
// the session rather than the database would keep enforcing a number the admin has already replaced.
//----------------------------------------------------------------------------------------------------------------------

describe('quota enforcement over the wire', () =>
{
    const ADMIN_EMAIL = 'quota-admin@fileshed.test';
    const ADMIN_PASSWORD = 'admin-password-e2e';

    // A single small fixture is the user's entire allowance; a second, larger payload cannot fit alongside it.
    const allowance = smallFixture('quota-exact');
    const LIMIT = allowance.length;

    let quotaServer : ServerHandle;
    let user : ApiClient;
    let quotaAdmin : ApiClient;
    let quotaUserID : string;

    beforeAll(async () =>
    {
        quotaServer = await spawnServer({ env: { FILESHED_SETUP_TOKEN: 'e2e-setup-token-1234' } });

        const setup = await new ApiClient(quotaServer.baseURL).post('/api/setup', {
            token: 'e2e-setup-token-1234',
            name: 'Administrator',
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
        });
        if(setup.status !== 200) { throw new Error('setup: expected first-run setup to succeed'); }

        const registrant = new ApiClient(quotaServer.baseURL);
        await registrant.signUp('quota-user@example.com', PASSWORD);
        quotaUserID = (await (await registrant.get('/api/me')).json() as MeResponse).id;

        quotaAdmin = new ApiClient(quotaServer.baseURL);
        await quotaAdmin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
        const setQuota = await quotaAdmin.patch(`/api/admin/users/${ quotaUserID }`, { quotaLimit: LIMIT });
        if(setQuota.status !== 200) { throw new Error('setup: expected the admin to set the quota'); }

        user = new ApiClient(quotaServer.baseURL);
        await user.signIn('quota-user@example.com', PASSWORD);
    });

    afterAll(async () =>
    {
        await quotaServer?.stop();
    });

    it('refuses a claim that would exceed the quota, storing no blob and no node', async () =>
    {
        const oversize = Buffer.concat([ smallFixture('quota-over-a'), smallFixture('quota-over-b') ]);
        const oversizeSha = sha256Of(oversize);

        const res = await user.post('/api/blobs/claim', { sha256: oversizeSha, size: oversize.length });
        expect(res.status).toBe(403);

        const blob = await withDb(quotaServer, (db) => db
            .selectFrom('blob')
            .select('sha256')
            .where('sha256', '=', oversizeSha)
            .executeTakeFirst());
        expect(blob).toBeUndefined();

        const nodes = await withDb(quotaServer, (db) => db
            .selectFrom('node')
            .select('id')
            .where('blob_id', '=', oversizeSha)
            .execute());
        expect(nodes).toHaveLength(0);
    });

    it('admits a claim that lands exactly at the quota and commits the upload', async () =>
    {
        const exactSha = sha256Of(allowance);

        const claim = await (await user.post('/api/blobs/claim', { sha256: exactSha, size: allowance.length }))
            .json() as ClaimResponse;
        expect(claim.upload).toBe(true);
        if(claim.upload !== true) { throw new Error('expected an upload ticket at exactly the limit'); }

        const params = new URLSearchParams({ name: 'exact.bin', mimeType: 'application/octet-stream' });
        const put = await user.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, allowance);
        expect(put.status).toBe(200);

        const me = await (await user.get('/api/me')).json() as MeResponse;
        expect(me.quota.used).toBe(LIMIT);
        expect(me.quota.limit).toBe(LIMIT);
    });

    // The user is full and stays signed in throughout: their session (cookie cache included) still carries the old
    // limit, and nothing signs them out or refreshes it. A quota the admin has already raised must free their very
    // next upload, and the profile must report the new number rather than the one the session was issued with.
    it('lets an admin-raised quota through on the very next upload, with no re-authentication', async () =>
    {
        const raised = await quotaAdmin.patch(`/api/admin/users/${ quotaUserID }`, { quotaLimit: LIMIT * 4 });
        expect(raised.status).toBe(200);

        const extra = smallFixture('quota-after-raise');
        const extraSha = sha256Of(extra);

        const claim = await (await user.post('/api/blobs/claim', { sha256: extraSha, size: extra.length }))
            .json() as ClaimResponse;
        expect(claim.upload).toBe(true);
        if(claim.upload !== true) { throw new Error('expected a ticket once the admin raised the quota'); }

        const params = new URLSearchParams({ name: 'after-raise.bin', mimeType: 'application/octet-stream' });
        expect((await user.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, extra)).status).toBe(200);

        const me = await (await user.get('/api/me')).json() as MeResponse;
        expect(me.quota.used).toBe(LIMIT + extra.length);
        expect(me.quota.limit).toBe(LIMIT * 4);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Failed proof-of-possession and the per-user rate limit
//
// A user who does not possess a known blob's bytes cannot answer its challenge: a wrong proof is forbidden and commits
// nothing. Repeated failures are a hash-probing signal, so they are counted per user and, past MAX_FAILED_PROOFS,
// rate-limited -- the next attempt is refused before the proof is even evaluated.
//----------------------------------------------------------------------------------------------------------------------

describe('failed proof-of-possession', () =>
{
    let carl : ApiClient;
    let carlID : string;

    beforeAll(async () =>
    {
        carl = new ApiClient(server.baseURL);
        await carl.signUp('carl@example.com', PASSWORD);
        carlID = await callerID(carl);
    });

    // Claim the known large blob (a challenge, since it is >= 1 MiB), then answer with a corrupted -- and so certainly
    // wrong -- proof. Corrupting the correct answer's first hex digit guarantees a mismatch of the right length.
    async function submitWrongProof() : Promise<number>
    {
        const challenge = await (await carl.post('/api/blobs/claim', { sha256: sha, size: data.length }))
            .json() as ClaimResponse;
        if(challenge.upload !== false) { throw new Error('expected a proof-of-possession challenge'); }

        const correct = computeAnswer(challenge.nonce, challenge.ranges, data);
        const wrong = (correct.startsWith('0') ? 'f' : '0') + correct.slice(1);

        const res = await carl.post(`/api/blobs/claim/${ challenge.challengeID }`, {
            answer: wrong,
            name: 'stolen.bin',
            parentID: null,
            mimeType: 'application/octet-stream',
        });
        return res.status;
    }

    async function carlNodeCount() : Promise<number>
    {
        const rows = await withDb(server, (db) => db
            .selectFrom('node')
            .select('id')
            .where('owner_id', '=', carlID)
            .where('blob_id', '=', sha)
            .execute());
        return rows.length;
    }

    // Sequential failures via recursion rather than a loop (no-await-in-loop); each lands before the next is judged.
    async function exhaustProofs(remaining : number) : Promise<void>
    {
        if(remaining <= 0) { return; }
        expect(await submitWrongProof()).toBe(403);
        return exhaustProofs(remaining - 1);
    }

    it('forbids a wrong proof, commits no node, and rate-limits after repeated failures', async () =>
    {
        // The first wrong proof is forbidden and creates nothing for the prober.
        expect(await submitWrongProof()).toBe(403);
        expect(await carlNodeCount()).toBe(0);

        // Burn the rest of the per-user allowance; every failure is still a 403.
        await exhaustProofs(MAX_FAILED_PROOFS - 1);

        // The next attempt is rejected by the rate limit before the proof is evaluated.
        expect(await submitWrongProof()).toBe(429);
        expect(await carlNodeCount()).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Ticket and challenge misuse
//
// The single-use, per-user nature of the upload ticket, and the not-found handling for an unknown challenge id.
//----------------------------------------------------------------------------------------------------------------------

describe('upload ticket and challenge misuse', () =>
{
    // Reusing a consumed ticket stores nothing a second time; what comes back is the file the first PUT made. A
    // client whose reply died on the way back cannot tell that from a lost request, and only one of those answers
    // is true.
    it('answers a reuse of a consumed upload ticket with the file it already stored', async () =>
    {
        const uploader = new ApiClient(server.baseURL);
        await uploader.signUp('ticket-reuse@example.com', PASSWORD);

        const bytes = smallFixture('ticket-reuse');
        const claim = await (await uploader.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
            .json() as ClaimResponse;
        if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

        const params = new URLSearchParams({ name: 'once.bin', mimeType: 'application/octet-stream' });
        const first = await uploader.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes);
        const again = await uploader.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes);

        expect(first.status).toBe(200);
        expect(again.status).toBe(200);
        expect(await again.json()).toMatchObject({ id: (await first.json() as { id : string }).id });

        // And exactly one file exists, whatever the ticket was asked twice.
        const listing = await (await uploader.get('/api/nodes/children')).json() as { nodes : { name : string }[] };
        expect(listing.nodes.filter((node) => node.name === 'once.bin')).toHaveLength(1);
    });

    it('403s a PUT of a ticket issued to a different user', async () =>
    {
        const holder = new ApiClient(server.baseURL);
        const intruder = new ApiClient(server.baseURL);
        await holder.signUp('ticket-holder@example.com', PASSWORD);
        await intruder.signUp('ticket-intruder@example.com', PASSWORD);

        const bytes = smallFixture('ticket-crossuser');
        const claim = await (await holder.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length }))
            .json() as ClaimResponse;
        if(claim.upload !== true) { throw new Error('expected an upload ticket'); }

        const params = new URLSearchParams({ name: 'theirs.bin', mimeType: 'application/octet-stream' });
        expect((await intruder.put(`/api/uploads/${ claim.ticket }?${ params.toString() }`, bytes)).status).toBe(403);
    });

    it('404s an answer to an unknown challenge id', async () =>
    {
        const prober = new ApiClient(server.baseURL);
        await prober.signUp('challenge-unknown@example.com', PASSWORD);

        const res = await prober.post('/api/blobs/claim/nonexistent-challenge', {
            answer: '0'.repeat(64),
            name: 'nope.bin',
            parentID: null,
            mimeType: 'application/octet-stream',
        });
        expect(res.status).toBe(404);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Content replace lifecycle
//
// Saving an edited file overwrites the bytes of an EXISTING node: a fresh file is uploaded, then replaced through the
// same ticket flow with replaceNodeID. The node keeps its id (so links and shares survive), now serves the new bytes,
// and the blob it used to hold -- left unreferenced -- is graveyarded.
//----------------------------------------------------------------------------------------------------------------------

describe('content replace lifecycle', () =>
{
    let replacer : ApiClient;

    beforeAll(async () =>
    {
        replacer = new ApiClient(server.baseURL);
        await replacer.signUp('replacer@example.com', PASSWORD);
    });

    it('replaces a file in place: same node id, new bytes served, old blob graveyarded', async () =>
    {
        // A fresh file to edit-and-save over.
        const original = smallFixture('replace-original');
        const originalSha = sha256Of(original);
        const originalBody = { sha256: originalSha, size: original.length };
        const originalClaimRes = await replacer.post('/api/blobs/claim', originalBody);
        const originalClaim = await originalClaimRes.json() as ClaimResponse;
        if(originalClaim.upload !== true) { throw new Error('setup: expected a ticket for the fresh file'); }

        const createParams = new URLSearchParams({ name: 'editable.txt', mimeType: 'text/plain' });
        const createUrl = `/api/uploads/${ originalClaim.ticket }?${ createParams.toString() }`;
        const created = await (await replacer.put(createUrl, original)).json() as NodeResponse;

        // New content for the same node.
        const replacement = smallFixture('replace-new-content');
        const replacementSha = sha256Of(replacement);
        const replaceBody = { sha256: replacementSha, size: replacement.length };
        const replaceClaimRes = await replacer.post('/api/blobs/claim', replaceBody);
        const replaceClaim = await replaceClaimRes.json() as ClaimResponse;
        if(replaceClaim.upload !== true) { throw new Error('setup: expected a ticket for the replacement bytes'); }

        const replaceParams = new URLSearchParams({ replaceNodeID: created.id });
        const replaceUrl = `/api/uploads/${ replaceClaim.ticket }?${ replaceParams.toString() }`;
        const res = await replacer.put(replaceUrl, replacement);
        const replaced = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        // Same node identity, new content.
        expect(replaced.id).toBe(created.id);
        expect(replaced.type).toBe('file');
        if(replaced.type !== 'file') { throw new Error('expected a file node'); }
        expect(replaced.blobID).toBe(replacementSha);
        expect(replaced.size).toBe(replacement.length);
        expect(replaced.role).toBe('owner');

        // The node serves the new bytes: the stored blob for the new sha hashes back to it.
        expect(await blobFileExists(server.storageRoot, replacementSha)).toBe(true);
        expect(sha256Of(await readBlobFile(server.storageRoot, replacementSha))).toBe(replacementSha);

        // Re-reading by id confirms the repoint persisted to the same node.
        const reread = await (await replacer.get(`/api/nodes/${ created.id }`)).json() as NodeResponse;
        if(reread.type !== 'file') { throw new Error('expected a file node on re-read'); }
        expect(reread.blobID).toBe(replacementSha);

        // The old blob lost its only reference and is graveyarded.
        const oldBlob = await withDb(server, (db) => db
            .selectFrom('blob')
            .select('deleted_at')
            .where('sha256', '=', originalSha)
            .executeTakeFirst());
        expect(oldBlob?.deleted_at).not.toBeNull();
    });

    // The editor's optimistic-concurrency guard over real sockets: a save pinned to the blob it opened from lands
    // while that is still current, and a later save still pinning the now-stale blob is refused 409 rather than
    // clobbering the content that won the race.
    it('honours the ifBlobID guard: a matching save lands, a stale one is refused 409 and changes nothing', async () =>
    {
        // Claim fresh bytes and return the upload ticket (fresh content is always unknown, so always a ticket).
        async function claimTicket(bytes : Buffer) : Promise<string>
        {
            const claim = await (
                await replacer.post('/api/blobs/claim', { sha256: sha256Of(bytes), size: bytes.length })
            ).json() as ClaimResponse;
            if(claim.upload !== true) { throw new Error('setup: expected a ticket for fresh bytes'); }
            return claim.ticket;
        }

        // A fresh markdown file to edit-and-save over.
        const opened = smallFixture('guard-opened');
        const openedSha = sha256Of(opened);
        const createParams = new URLSearchParams({ name: 'guarded.md', mimeType: 'text/markdown' });
        const created = await (
            await replacer.put(`/api/uploads/${ await claimTicket(opened) }?${ createParams }`, opened)
        ).json() as NodeResponse;

        // The client saves what it edited, pinning the blob it opened -- still current, so it lands.
        const winner = smallFixture('guard-winner');
        const winnerSha = sha256Of(winner);
        const winnerParams = new URLSearchParams({ replaceNodeID: created.id, ifBlobID: openedSha });
        const savedRes = await replacer.put(`/api/uploads/${ await claimTicket(winner) }?${ winnerParams }`, winner);
        expect(savedRes.status).toBe(200);

        // A GET serves the new bytes: the node now reads back the winning content.
        const afterSave = await (await replacer.get(`/api/nodes/${ created.id }`)).json() as NodeResponse;
        if(afterSave.type !== 'file') { throw new Error('expected a file node'); }
        expect(afterSave.blobID).toBe(winnerSha);

        // A second save still pinning the ORIGINAL blob is stale -- the content moved on -- so it is refused.
        const stale = smallFixture('guard-stale');
        const staleParams = new URLSearchParams({ replaceNodeID: created.id, ifBlobID: openedSha });
        const staleRes = await replacer.put(`/api/uploads/${ await claimTicket(stale) }?${ staleParams }`, stale);
        expect(staleRes.status).toBe(409);

        // The 409 changed nothing: the node still serves the winning content.
        const afterConflict = await (await replacer.get(`/api/nodes/${ created.id }`)).json() as NodeResponse;
        if(afterConflict.type !== 'file') { throw new Error('expected a file node'); }
        expect(afterConflict.blobID).toBe(winnerSha);
    });
});

//----------------------------------------------------------------------------------------------------------------------
