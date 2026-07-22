//----------------------------------------------------------------------------------------------------------------------
// Content Replace — the "save an edit" / "Replace on collision" commit path, end to end
//
// Drives the real routes -> BlobManager -> real fs store + in-memory database with app.request (zero mocks). A replace
// puts new bytes onto an EXISTING file node: the node keeps its id (so links and shares survive), its blob/size/mime
// move, the old blob is graveyard-checked, and the charge lands on the file's OWNER -- never the acting editor. Every
// expectation is derived from those rules, not from what the code returns; proof answers are computed locally from the
// fixture bytes the way a possessing client would.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClaimResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { NodeRA } from '@server/resource-access/nodes/node.ts';

// Support
import {
    type BootedBlobApp,
    type TestUser,
    answerReplace,
    blobDeletedAt,
    blobRowCount,
    bootBlobApp,
    claim,
    computeAnswer,
    fileNodesForBlob,
    grantShare,
    makeUser,
    nodeContentRow,
    putReplace,
    putUpload,
    storedBytes,
} from './support.ts';
import { folderNode } from '../resource-access/nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

// Just over 1 MiB: past the threshold where a known blob is proof-challenged rather than re-uploaded.
function largeFixture() : Buffer
{
    return randomBytes((1024 * 1024) + 321);
}

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedBlobApp;

beforeEach(async () =>
{
    booted = await bootBlobApp();
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------
// Helpers
//----------------------------------------------------------------------------------------------------------------------

interface UploadMeta
{
    name : string;
    mimeType : string;
    parentID ?: string | null;
}

const defaultUploadMeta : UploadMeta = { name: 'f.bin', mimeType: 'application/octet-stream' };

// Upload bytes as a fresh file the user owns (the ordinary create flow), returning the committed file node.
async function uploadOwned(user : TestUser, bytes : Buffer, metadata : UploadMeta = defaultUploadMeta)
: Promise<NodeResponse>
{
    const claimRes = await claim(booted.app, user.cookie, sha256Of(bytes), bytes.length);
    const claimBody = await claimRes.json() as ClaimResponse;
    if(claimBody.upload !== true) { throw new Error('setup: expected an upload ticket for a fresh blob'); }

    const res = await putUpload(booted.app, user.cookie, claimBody.ticket, bytes, {
        name: metadata.name,
        mimeType: metadata.mimeType,
        parentID: metadata.parentID ?? null,
    });
    if(res.status !== 200) { throw new Error(`setup: upload failed with ${ res.status }`); }

    return await res.json() as NodeResponse;
}

// Claim fresh replacement bytes (always a ticket -- fresh content) and commit them onto an existing file in one step.
async function replaceViaUpload(user : TestUser, bytes : Buffer, targetID : string, mimeType ?: string)
: Promise<Response>
{
    const claimRes = await claim(booted.app, user.cookie, sha256Of(bytes), bytes.length);
    const claimBody = await claimRes.json() as ClaimResponse;
    if(claimBody.upload !== true) { throw new Error('setup: expected an upload ticket for fresh replacement bytes'); }

    return putReplace(booted.app, user.cookie, claimBody.ticket, bytes, targetID, mimeType);
}

async function ownedBytesOf(userID : string) : Promise<number>
{
    return new NodeRA(booted.handle).ownedBytes(userID);
}

//----------------------------------------------------------------------------------------------------------------------
// Owner replaces their own file through the upload path.
//----------------------------------------------------------------------------------------------------------------------

describe('replace via upload ticket — owner', () =>
{
    it('repoints the node at new bytes in place, keeping its id, name and parent', async () =>
    {
        const owner = await makeUser(booted, 'own-replace@example.com');
        const original = randomBytes(2048);
        const file = await uploadOwned(owner, original, { name: 'notes.txt', mimeType: 'text/plain' });

        const replacement = randomBytes(4096);
        const replacementSha = sha256Of(replacement);
        const beforeReplace = Date.now();

        const res = await replaceViaUpload(owner, replacement, file.id, 'text/markdown');
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }

        // Same node identity: a replace is not a new node -- id, name, parent, and creation time are untouched.
        expect(node.id).toBe(file.id);
        expect(node.name).toBe('notes.txt');
        expect(node.parentID).toBe(file.parentID);
        expect(node.createdAt).toBe(file.createdAt);
        expect(node.role).toBe('owner');

        // New content: blob, size, mime, and a freshly bumped updated_at.
        expect(node.blobID).toBe(replacementSha);
        expect(node.size).toBe(replacement.length);
        expect(node.mimeType).toBe('text/markdown');
        expect(new Date(node.updatedAt).getTime()).toBeGreaterThanOrEqual(beforeReplace);

        // The row and the stored bytes agree with the response.
        const row = await nodeContentRow(booted.handle, file.id);
        expect(row.blob_id).toBe(replacementSha);
        expect(Number(row.size)).toBe(replacement.length);
        expect(row.mime_type).toBe('text/markdown');
        expect(await storedBytes(booted, replacementSha)).toEqual(replacement);

        // The owner's charged usage moves from the old size to the new one.
        expect(await ownedBytesOf(owner.id)).toBe(replacement.length);
    });

    it('keeps the node\'s current mime type when the replace omits one', async () =>
    {
        const owner = await makeUser(booted, 'own-mime@example.com');
        const file = await uploadOwned(owner, randomBytes(1024), { name: 'keep.md', mimeType: 'text/markdown' });

        const res = await replaceViaUpload(owner, randomBytes(2048), file.id);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        // An edit save carries no mime type; the node keeps the one it had.
        expect(node.mimeType).toBe('text/markdown');
    });

    it('graveyards the old blob once the replace leaves it unreferenced', async () =>
    {
        const owner = await makeUser(booted, 'grave@example.com');
        const original = randomBytes(2048);
        const originalSha = sha256Of(original);
        const file = await uploadOwned(owner, original);

        expect(await blobDeletedAt(booted.handle, originalSha)).toBeNull();

        const replacement = randomBytes(2048);
        const res = await replaceViaUpload(owner, replacement, file.id);
        expect(res.status).toBe(200);

        // The node no longer references the old blob and nothing else does -- it is graveyarded.
        expect(await blobDeletedAt(booted.handle, originalSha)).not.toBeNull();
        expect(await blobRowCount(booted.handle, sha256Of(replacement))).toBe(1);
    });

    it('leaves the old blob live when another node still references it', async () =>
    {
        const owner = await makeUser(booted, 'shared-blob-owner@example.com');
        const shared = randomBytes(2048);
        const sharedSha = sha256Of(shared);
        const file = await uploadOwned(owner, shared);

        // A second user uploads the same bytes: dedup keeps one blob row now referenced by two file nodes.
        const other = await makeUser(booted, 'shared-blob-other@example.com');
        const otherFile = await uploadOwned(other, shared);
        expect(await blobRowCount(booted.handle, sharedSha)).toBe(1);

        const res = await replaceViaUpload(owner, randomBytes(2048), file.id);
        expect(res.status).toBe(200);

        // The other node still references the shared blob, so the replace must NOT graveyard it.
        expect(await blobDeletedAt(booted.handle, sharedSha)).toBeNull();
        const stillOnShared = (await fileNodesForBlob(booted.handle, sharedSha)).map((row) => row.id);
        expect(stillOnShared).toEqual([ otherFile.id ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// An editor on a shared file may replace its content, and the charge lands on the file's OWNER.
//----------------------------------------------------------------------------------------------------------------------

describe('replace by a shared editor — owner-charged quota', () =>
{
    it('lets an editor replace a shared file, charging the owner and leaving the editor uncharged', async () =>
    {
        const owner = await makeUser(booted, 'ed-owner@example.com', 100_000);
        const file = await uploadOwned(owner, randomBytes(4096));

        const editor = await makeUser(booted, 'ed-editor@example.com', null);
        await grantShare(booted.handle, file.id, editor.id, 'editor', owner.id);

        const replacement = randomBytes(8192);
        const res = await replaceViaUpload(editor, replacement, file.id);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        // The response carries the actor's real role, and the file is still owned by its owner.
        expect(node.role).toBe('editor');
        expect(node.ownerID).toBe(owner.id);
        expect(node.blobID).toBe(sha256Of(replacement));

        // The charge landed on the owner (usage grew to the new size); the editor owns nothing and is uncharged.
        expect(await ownedBytesOf(owner.id)).toBe(8192);
        expect(await ownedBytesOf(editor.id)).toBe(0);
    });

    it(
        'refuses an editor\'s replace whose size delta would exceed the OWNER\'s quota, rolling back entirely',
        async () =>
        {
            // The owner's quota is exactly their current file's size, so any growth overshoots.
            const owner = await makeUser(booted, 'ed-cap-owner@example.com', 4096);
            const original = randomBytes(4096);
            const originalSha = sha256Of(original);
            const file = await uploadOwned(owner, original);

            // The editor is unlimited: their own quota is irrelevant to the owner-charged write.
            const editor = await makeUser(booted, 'ed-cap-editor@example.com', null);
            await grantShare(booted.handle, file.id, editor.id, 'editor', owner.id);

            const replacement = randomBytes(8192);
            const replacementSha = sha256Of(replacement);
            const res = await replaceViaUpload(editor, replacement, file.id);

            expect(res.status).toBe(403);

            // Full rollback: the node still points at the old blob at the old size, no new blob row exists, and the
            // owner's usage is untouched.
            const row = await nodeContentRow(booted.handle, file.id);
            expect(row.blob_id).toBe(originalSha);
            expect(Number(row.size)).toBe(4096);
            expect(await blobRowCount(booted.handle, replacementSha)).toBe(0);
            expect(await ownedBytesOf(owner.id)).toBe(4096);
        }
    );

    it('admits a negative-delta replace even with the owner exactly at their quota', async () =>
    {
        const owner = await makeUser(booted, 'shrink-owner@example.com', 4096);
        const file = await uploadOwned(owner, randomBytes(4096));
        expect(await ownedBytesOf(owner.id)).toBe(4096);

        const editor = await makeUser(booted, 'shrink-editor@example.com', null);
        await grantShare(booted.handle, file.id, editor.id, 'editor', owner.id);

        // A smaller replacement: the delta is negative, so the resulting usage drops below the limit and admits.
        const res = await replaceViaUpload(editor, randomBytes(1024), file.id);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.size).toBe(1024);
        expect(await ownedBytesOf(owner.id)).toBe(1024);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Replace rejections: who and what may not be replaced.
//----------------------------------------------------------------------------------------------------------------------

describe('replace rejections', () =>
{
    it('forbids a viewer from replacing a file shared to them (403), leaving it untouched', async () =>
    {
        const owner = await makeUser(booted, 'view-owner@example.com');
        const original = randomBytes(2048);
        const originalSha = sha256Of(original);
        const file = await uploadOwned(owner, original);

        const viewer = await makeUser(booted, 'view-viewer@example.com');
        await grantShare(booted.handle, file.id, viewer.id, 'viewer', owner.id);

        const res = await replaceViaUpload(viewer, randomBytes(2048), file.id);
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.[0]?.code).toBe('replace.notEditor');
        expect((await nodeContentRow(booted.handle, file.id)).blob_id).toBe(originalSha);
    });

    it('rejects replacing a folder\'s content as a typed non-file rejection (422)', async () =>
    {
        const owner = await makeUser(booted, 'folder-target@example.com');
        await new NodeRA(booted.handle).insert(folderNode({ id: 'a-folder', ownerID: owner.id }));

        const res = await replaceViaUpload(owner, randomBytes(1024), 'a-folder');
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations?.[0]?.code).toBe('replace.notFile');
    });

    it('reads an unresolvable target as absent (404)', async () =>
    {
        const owner = await makeUser(booted, 'priv-owner@example.com');
        const file = await uploadOwned(owner, randomBytes(2048));

        // A stranger with no share cannot resolve the file, so a replace aimed at it 404s rather than confirming it.
        const stranger = await makeUser(booted, 'priv-stranger@example.com');
        const res = await replaceViaUpload(stranger, randomBytes(2048), file.id);

        expect(res.status).toBe(404);
    });

    it('reads a trashed target as absent to a non-owner editor (404)', async () =>
    {
        const owner = await makeUser(booted, 'trash-owner@example.com');
        const file = await uploadOwned(owner, randomBytes(2048));

        const editor = await makeUser(booted, 'trash-editor@example.com');
        await grantShare(booted.handle, file.id, editor.id, 'editor', owner.id);

        // The owner trashes the file; recipients lose sight of it, so an editor's replace 404s.
        await new NodeRA(booted.handle).setTrashed(file.id, new Date());

        const res = await replaceViaUpload(editor, randomBytes(2048), file.id);

        expect(res.status).toBe(404);
    });

    it('lets an owner replace their own trashed file, and it stays trashed', async () =>
    {
        const owner = await makeUser(booted, 'trash-self@example.com');
        const file = await uploadOwned(owner, randomBytes(2048));
        await new NodeRA(booted.handle).setTrashed(file.id, new Date());

        const replacement = randomBytes(1024);
        const res = await replaceViaUpload(owner, replacement, file.id);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.blobID).toBe(sha256Of(replacement));
        // The replace overwrites content only; a trashed file stays trashed.
        expect(node.trashedAt).not.toBeNull();
        expect((await nodeContentRow(booted.handle, file.id)).trashed_at).not.toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Replace through the proof-of-possession path: a known blob repoints a node with zero bytes uploaded.
//----------------------------------------------------------------------------------------------------------------------

describe('replace via proof-of-possession', () =>
{
    it('replaces a file with a known blob after a correct proof, moving zero bytes', async () =>
    {
        const owner = await makeUser(booted, 'pop-owner@example.com');

        // A large blob the owner already holds (so a later claim of it is challenged, not re-uploaded).
        const known = largeFixture();
        const knownSha = sha256Of(known);
        await uploadOwned(owner, known, { name: 'held.bin', mimeType: 'application/octet-stream' });

        // A separate small file whose content will be replaced by the known blob.
        const original = randomBytes(2048);
        const originalSha = sha256Of(original);
        const file = await uploadOwned(owner, original, { name: 'target.bin', mimeType: 'application/octet-stream' });

        // Claiming the known large blob yields a challenge, not a ticket -- no bytes are uploaded on the replace.
        const challengeRes = await claim(booted.app, owner.cookie, knownSha, known.length);
        const challenge = await challengeRes.json() as ClaimResponse;
        expect(challenge.upload).toBe(false);
        if(challenge.upload !== false) { throw new Error('expected a proof-of-possession challenge'); }

        const answer = computeAnswer(challenge.nonce, challenge.ranges, known);
        const res = await answerReplace(booted.app, owner.cookie, challenge.challengeID, answer, file.id);
        const node = await res.json() as NodeResponse;

        expect(res.status).toBe(200);
        if(node.type !== 'file') { throw new Error('expected a file node'); }
        expect(node.id).toBe(file.id);
        expect(node.blobID).toBe(knownSha);
        expect(node.size).toBe(known.length);

        // Still one row for the known blob (both the held file and the replaced target reference it); the small blob
        // the target used to hold is now unreferenced and graveyarded.
        expect(await blobRowCount(booted.handle, knownSha)).toBe(1);
        expect(await blobDeletedAt(booted.handle, originalSha)).not.toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
