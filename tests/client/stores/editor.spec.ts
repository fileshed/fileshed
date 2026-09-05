//----------------------------------------------------------------------------------------------------------------------
// Editor Store
//
// Drives the load / edit / save / conflict pipeline with the resource-access, hashing, and proof seams mocked. Each
// test asserts an observable outcome -- the buffer and dirty state after a load, the single save a quiet period
// debounces to, the guard carried on the commit, the conflict state a 409 raises, or the guard dropped on an overwrite
// -- never merely that a mock was called. Expectations come from the store's contract, not its internals.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse, Role } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { getNode, patchNode } from '@client/resource-access/nodes.ts';
import { fetchNodeText } from '@client/resource-access/content.ts';
import { answerChallenge, claimBlob, uploadTicket } from '@client/resource-access/blobs.ts';

// Engines
import { computeProofAnswer } from '@client/engines/claim.ts';

// Utils
import { hashFile, readSampleWindows } from '@client/utils/hashFile.ts';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn(), patchNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeText: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    uploadTicket: vi.fn(),
    answerChallenge: vi.fn(),
}));
vi.mock('@client/engines/claim.ts', () => ({ computeProofAnswer: vi.fn() }));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getNodeMock = getNode as unknown as Mock;
const fetchTextMock = fetchNodeText as unknown as Mock;
const claimBlobMock = claimBlob as unknown as Mock;
const uploadTicketMock = uploadTicket as unknown as Mock;
const answerChallengeMock = answerChallenge as unknown as Mock;
const proofMock = computeProofAnswer as unknown as Mock;
const hashFileMock = hashFile as unknown as Mock;
const readWindowsMock = readSampleWindows as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode(overrides : Partial<{
    id : string;
    name : string;
    role : Role;
    blobID : string;
    size : number;
    mimeType : string;
}> = {}) : NodeResponse
{
    return {
        sharing: null,
        id: overrides.id ?? 'f1',
        name: overrides.name ?? 'notes.txt',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: overrides.role ?? 'owner',
        type: 'file',
        blobID: overrides.blobID ?? 'b1',
        size: overrides.size ?? 10,
        mimeType: overrides.mimeType ?? 'text/plain',
        trashedAt: null,
    };
}

// A store loaded and ready over a file with blob 'b1' and the text 'hello'. Save defaults to a fresh-content ticket
// commit landing a node whose blob is 'b2'; individual tests override the pieces they exercise.
async function openReady(overrides : Parameters<typeof fileNode>[0] = {}) : Promise<ReturnType<typeof useEditorStore>>
{
    getNodeMock.mockResolvedValue(fileNode(overrides));
    fetchTextMock.mockResolvedValue('hello');

    const store = useEditorStore();
    await store.open('f1');
    return store;
}

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();

    claimBlobMock.mockResolvedValue({ upload: true, ticket: 'tk' });
    uploadTicketMock.mockResolvedValue(fileNode({ blobID: 'b2' }));
    answerChallengeMock.mockResolvedValue(fileNode({ blobID: 'b2' }));
    hashFileMock.mockResolvedValue('freshsha');
    proofMock.mockResolvedValue('proof-answer');
    readWindowsMock.mockResolvedValue([]);
});

//----------------------------------------------------------------------------------------------------------------------
// Load
//----------------------------------------------------------------------------------------------------------------------

describe('useEditorStore.open', () =>
{
    it('loads a file into a ready, clean buffer an owner can edit', async () =>
    {
        const store = await openReady();

        expect(store.loadState).toBe('ready');
        expect(store.buffer).toBe('hello');
        expect(store.dirty).toBe(false);
        expect(store.readOnly).toBe(false);
    });

    it('opens a file shared read-only to a viewer as read-only', async () =>
    {
        const store = await openReady({ role: 'viewer' });

        expect(store.loadState).toBe('ready');
        expect(store.readOnly).toBe(true);
    });

    it('lets an editor (not just the owner) edit', async () =>
    {
        const store = await openReady({ role: 'editor' });

        expect(store.readOnly).toBe(false);
    });

    it('derives the default editor mode from the loaded file', async () =>
    {
        const store = await openReady({ name: 'readme.md', mimeType: 'text/markdown' });

        expect(store.mode).toBe('markdown');
    });

    it('refuses a file over the editable cap without fetching its bytes', async () =>
    {
        const store = await openReady({ size: 1_474_561 });

        expect(store.loadState).toBe('error');
        expect(fetchTextMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Dirty tracking and autosave debounce
//----------------------------------------------------------------------------------------------------------------------

describe('useEditorStore autosave', () =>
{
    it('marks the buffer dirty on an edit that diverges from the saved text', async () =>
    {
        const store = await openReady();

        store.setBuffer('hello world');

        expect(store.dirty).toBe(true);
    });

    it('clears dirty when the buffer is edited back to the saved text', async () =>
    {
        const store = await openReady();

        store.setBuffer('changed');
        store.setBuffer('hello');

        expect(store.dirty).toBe(false);
    });

    it('debounces a burst of edits into a single autosave after the quiet period', async () =>
    {
        vi.useFakeTimers();
        try
        {
            const store = await openReady();

            store.setBuffer('a');
            store.setBuffer('ab');
            store.setBuffer('abc');

            // Nothing has fired yet: the quiet period has not elapsed.
            expect(claimBlobMock).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(2000);

            // Exactly one save for the whole burst.
            expect(claimBlobMock).toHaveBeenCalledTimes(1);
            expect(uploadTicketMock).toHaveBeenCalledTimes(1);
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it('does not autosave a read-only session', async () =>
    {
        vi.useFakeTimers();
        try
        {
            const store = await openReady({ role: 'viewer' });

            store.setBuffer('a viewer somehow typed');
            await vi.advanceTimersByTimeAsync(2000);

            expect(claimBlobMock).not.toHaveBeenCalled();
        }
        finally
        {
            vi.useRealTimers();
        }
    });

    it('an explicit save cancels the pending autosave so the change saves only once', async () =>
    {
        vi.useFakeTimers();
        try
        {
            const store = await openReady();

            store.setBuffer('edited');
            await store.save();

            expect(claimBlobMock).toHaveBeenCalledTimes(1);

            // The debounce that the edit armed must have been cancelled by the explicit save.
            await vi.advanceTimersByTimeAsync(2000);
            expect(claimBlobMock).toHaveBeenCalledTimes(1);
        }
        finally
        {
            vi.useRealTimers();
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Save
//----------------------------------------------------------------------------------------------------------------------

describe('useEditorStore.save', () =>
{
    it('skips the save entirely when the buffer already hashes to the stored blob', async () =>
    {
        const store = await openReady();
        hashFileMock.mockResolvedValue('b1'); // the buffer hashes to the blob already on the node

        store.setBuffer('cosmetically different but same bytes to the store');
        await store.save();

        expect(claimBlobMock).not.toHaveBeenCalled();
        expect(uploadTicketMock).not.toHaveBeenCalled();
        expect(store.dirty).toBe(false);
    });

    it('carries the loaded blob as the concurrency guard on the commit', async () =>
    {
        const store = await openReady();

        store.setBuffer('new content');
        await store.save();

        const commit = uploadTicketMock.mock.calls[0]?.[2];
        expect(commit).toEqual({ replaceNodeID: 'f1', ifBlobID: 'b1' });
        expect(store.dirty).toBe(false);
    });

    it('re-arms the guard with the newly written blob on each successful save', async () =>
    {
        const store = await openReady();

        hashFileMock.mockResolvedValueOnce('shaV2').mockResolvedValueOnce('shaV3');
        uploadTicketMock
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }))
            .mockResolvedValueOnce(fileNode({ blobID: 'b3' }));

        store.setBuffer('v2');
        await store.save();

        store.setBuffer('v3');
        await store.save();

        // The first save pinned the loaded blob; the second pinned what the first save wrote.
        expect(uploadTicketMock.mock.calls[0]?.[2].ifBlobID).toBe('b1');
        expect(uploadTicketMock.mock.calls[1]?.[2].ifBlobID).toBe('b2');
    });

    it('saves a known blob through the proof-of-possession path, carrying the guard', async () =>
    {
        const store = await openReady();
        claimBlobMock.mockResolvedValue({ upload: false, challengeID: 'c1', nonce: 'n1', ranges: [ [ 0, 4 ] ] });

        store.setBuffer('known content');
        await store.save();

        expect(uploadTicketMock).not.toHaveBeenCalled();
        expect(answerChallengeMock).toHaveBeenCalledWith('c1', {
            answer: 'proof-answer',
            replaceNodeID: 'f1',
            ifBlobID: 'b1',
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Conflict
//----------------------------------------------------------------------------------------------------------------------

describe('useEditorStore conflict', () =>
{
    it('raises the conflict state on a 409 and keeps the buffer dirty', async () =>
    {
        const store = await openReady();
        uploadTicketMock.mockRejectedValueOnce(new ApiError(409, 'The file changed since you opened it.'));

        store.setBuffer('my edit');
        await store.save();

        expect(store.conflict).toBe(true);
        expect(store.dirty).toBe(true);
        expect(store.buffer).toBe('my edit');
    });

    it('overwrite retries the save without the guard and clears the conflict', async () =>
    {
        const store = await openReady();
        uploadTicketMock
            .mockRejectedValueOnce(new ApiError(409, 'stale'))
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }));

        store.setBuffer('my edit');
        await store.save();
        expect(store.conflict).toBe(true);

        await store.overwrite();

        // The retry drops the ifBlobID guard entirely -- last-write-wins.
        expect(uploadTicketMock.mock.calls[1]?.[2]).toEqual({ replaceNodeID: 'f1' });
        expect(store.conflict).toBe(false);
        expect(store.dirty).toBe(false);
    });

    it('reload discards local edits and restores the server content', async () =>
    {
        const store = await openReady();
        uploadTicketMock.mockRejectedValueOnce(new ApiError(409, 'stale'));

        store.setBuffer('my edit');
        await store.save();
        expect(store.conflict).toBe(true);

        // The server now serves different content on reload.
        fetchTextMock.mockResolvedValue('their newer content');
        await store.reload();

        expect(store.conflict).toBe(false);
        expect(store.buffer).toBe('their newer content');
        expect(store.dirty).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('EditorStore.rename', () =>
{
    it('renames the loaded node and adopts the server response', async () =>
    {
        const store = useEditorStore();
        store.node = fileNode({ name: 'notes.txt' });
        (patchNode as unknown as Mock).mockResolvedValue(fileNode({ name: 'journal.txt' }));

        await store.rename('  journal.txt  ');

        expect(store.node?.name).toBe('journal.txt');
        expect(patchNode).toHaveBeenCalledWith('f1', { name: 'journal.txt' });
    });

    it('refuses to rename a read-only session', async () =>
    {
        const store = useEditorStore();
        store.node = fileNode({ name: 'notes.txt', role: 'viewer' });

        await store.rename('renamed.txt');

        expect(store.node?.name).toBe('notes.txt');
        expect(patchNode).not.toHaveBeenCalled();
    });

    it('ignores blank and unchanged names', async () =>
    {
        const store = useEditorStore();
        store.node = fileNode({ name: 'notes.txt' });

        await store.rename('   ');
        await store.rename('notes.txt');

        expect(store.node?.name).toBe('notes.txt');
        expect(patchNode).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
