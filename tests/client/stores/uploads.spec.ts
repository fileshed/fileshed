//----------------------------------------------------------------------------------------------------------------------
// Uploads Store
//
// Drives the queue pipeline with the resource-access and hashing seams mocked; the name-derivation and proof-answer
// engines run for real. Each test asserts an observable outcome -- an item's terminal status, the commit target handed
// to the upload, the proof answer fed to the challenge, or the concurrency the pump enforces -- not that a mock was
// merely called.
//----------------------------------------------------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { getChildren } from '@client/resource-access/nodes.ts';
import { answerChallenge, claimBlob } from '@client/resource-access/blobs.ts';
import { uploadWithProgress } from '@client/resource-access/uploadWithProgress.ts';

// Utils
import { hashFile, readSampleWindows } from '@client/utils/hashFile.ts';

// Stores
import { useDriveStore } from '@client/stores/drive.ts';
import { useUploadsStore } from '@client/stores/uploads.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),
    getNode: vi.fn(),
    createNode: vi.fn(),
    patchNode: vi.fn(),
    trashNode: vi.fn(),
    copyNode: vi.fn(),
    hardDeleteNode: vi.fn(),
}));

vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    answerChallenge: vi.fn(),
    uploadTicket: vi.fn(),
}));

vi.mock('@client/resource-access/uploadWithProgress.ts', () => ({ uploadWithProgress: vi.fn() }));

vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getChildrenMock = getChildren as unknown as Mock;
const claimBlobMock = claimBlob as unknown as Mock;
const answerChallengeMock = answerChallenge as unknown as Mock;
const uploadMock = uploadWithProgress as unknown as Mock;
const hashFileMock = hashFile as unknown as Mock;
const readWindowsMock = readSampleWindows as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode(id : string) : NodeResponse
{
    return {
        id,
        name: id,
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

// A children-listing envelope with the given total; a non-empty one carries a single existing node as the collision
// (and Replace) target.
function listing(total : number, targetID = 'existing') : NodeListResponse
{
    return { nodes: total > 0 ? [ fileNode(targetID) ] : [], total, limit: 1, offset: 0, owners: [] };
}

function uploadFile(name : string, size = 3, type = 'text/plain') : File
{
    return new File([ new Uint8Array(size) ], name, { type });
}

async function waitFor(predicate : () => boolean, label = 'condition') : Promise<void>
{
    for(let attempt = 0; attempt < 50; attempt += 1)
    {
        if(predicate()) { return; }

        // eslint-disable-next-line no-await-in-loop -- polling the async pipeline forward one microtask flush at a time
        await flushPromises();
    }

    throw new Error(`timed out waiting for ${ label }`);
}

//----------------------------------------------------------------------------------------------------------------------

describe('useUploadsStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Happy path -- an unknown blob: hash, no collision, claim a ticket, upload, done.
    //------------------------------------------------------------------------------------------------------------------

    it('runs a new file through hash, claim, and ticket upload to done', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('n1'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], 'folder1');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(claimBlobMock).toHaveBeenCalledWith({ sha256: 'sha-1', size: 3 });
        const call = uploadMock.mock.calls[0]?.[0];
        expect(call.ticket).toBe('TKT');
        expect(call.commit).toEqual({ name: 'report.txt', parentID: 'folder1', mimeType: 'text/plain' });
        expect(store.items[0]?.result?.id).toBe('n1');
    });

    it('refreshes the drive listing when the upload lands in the folder on screen', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('n1'));

        const drive = useDriveStore();
        drive.folderID = 'folder1';
        const refresh = vi.spyOn(drive, 'refresh').mockResolvedValue();

        const store = useUploadsStore();
        store.enqueue([ uploadFile('report.txt') ], 'folder1');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(refresh).toHaveBeenCalled();
    });

    it('does not refresh the drive when the upload lands in a different folder', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('n1'));

        const drive = useDriveStore();
        drive.folderID = 'somewhere-else';
        const refresh = vi.spyOn(drive, 'refresh').mockResolvedValue();

        const store = useUploadsStore();
        store.enqueue([ uploadFile('report.txt') ], 'folder1');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(refresh).not.toHaveBeenCalled();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Collisions
    //------------------------------------------------------------------------------------------------------------------

    it('keeps both by probing numbered names until one is free', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock
            .mockResolvedValueOnce(listing(1)) // report.txt collides
            .mockResolvedValueOnce(listing(1)) // report (1).txt taken
            .mockResolvedValueOnce(listing(0)); // report (2).txt free
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('n1'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.currentPrompt !== null, 'prompt');
        store.resolveCollision('keep-both');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(store.items[0]?.name).toBe('report (2).txt');
        expect(uploadMock.mock.calls[0]?.[0].commit.name).toBe('report (2).txt');
    });

    it('replaces by committing against the existing node id', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(1, 'target-9'));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('target-9'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.currentPrompt !== null, 'prompt');
        store.resolveCollision('replace');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(uploadMock.mock.calls[0]?.[0].commit).toEqual({ replaceNodeID: 'target-9', mimeType: 'text/plain' });
    });

    it('cancels just the colliding item when the user declines', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(1));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.currentPrompt !== null, 'prompt');
        store.resolveCollision('cancel');
        await waitFor(() => store.items[0]?.status === 'cancelled', 'cancelled');

        expect(claimBlobMock).not.toHaveBeenCalled();
        expect(uploadMock).not.toHaveBeenCalled();
    });

    it('asks about one collision at a time', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(1));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('n1'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('a.txt'), uploadFile('b.txt') ], null);
        await waitFor(() => store.currentPrompt !== null, 'first prompt');

        const firstName = store.currentPrompt?.name;
        expect([ 'a.txt', 'b.txt' ]).toContain(firstName);

        store.resolveCollision('cancel');
        await waitFor(() => store.currentPrompt?.name !== firstName && store.currentPrompt !== null, 'second prompt');

        expect(store.currentPrompt?.name).not.toBe(firstName);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Known blob -- the proof-of-possession path.
    //------------------------------------------------------------------------------------------------------------------

    it('answers a challenge for a known blob with a proof over the sampled windows', async () =>
    {
        hashFileMock.mockResolvedValue('sha-known');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: false, challengeID: 'CH', nonce: 'NONCE', ranges: [ [ 0, 4 ] ] });
        readWindowsMock.mockResolvedValue([ new Uint8Array([ 1, 2, 3, 4 ]).buffer ]);
        answerChallengeMock.mockResolvedValue(fileNode('n2'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        const [ challengeID, request ] = answerChallengeMock.mock.calls[0] ?? [];
        const expectedAnswer = createHmac('sha256', 'NONCE')
            .update(new Uint8Array([ 1, 2, 3, 4 ]))
            .digest('hex');

        expect(challengeID).toBe('CH');
        expect(request.answer).toBe(expectedAnswer);
        expect(request).toMatchObject({ name: 'report.txt', parentID: null, mimeType: 'text/plain' });
        expect(uploadMock).not.toHaveBeenCalled();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Failures
    //------------------------------------------------------------------------------------------------------------------

    it('lands a quota rejection on the item as an error with the server message', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockRejectedValue(new ApiError(403, 'You are over your storage quota.'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'error', 'error');

        expect(store.items[0]?.error).toBe('You are over your storage quota.');
    });

    it('re-queues a failed item on retry and can then succeed', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockRejectedValueOnce(new ApiError(503, 'Try again')).mockResolvedValue(fileNode('n1'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'error', 'error');

        store.retry(store.items[0]?.id ?? '');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(store.items[0]?.error).toBeNull();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Concurrency and cancellation
    //------------------------------------------------------------------------------------------------------------------

    it('runs at most three items at once, starting the next as one finishes', async () =>
    {
        const releases : ((sha : string) => void)[] = [];
        hashFileMock.mockImplementation(() => new Promise<string>((resolve) => { releases.push(resolve); }));
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockResolvedValue(fileNode('n1'));
        const store = useUploadsStore();

        store.enqueue(
            [ 'a', 'b', 'c', 'd', 'e' ].map((name) => uploadFile(`${ name }.txt`)),
            null
        );
        await waitFor(() => store.items.filter((item) => item.status !== 'queued').length === 3, 'three active');

        expect(store.items.filter((item) => item.status === 'queued').length).toBe(2);
        expect(hashFileMock).toHaveBeenCalledTimes(3);

        releases[0]?.('sha');
        await waitFor(() => hashFileMock.mock.calls.length === 4, 'fourth started');

        expect(hashFileMock).toHaveBeenCalledTimes(4);
    });

    it('cancels a still-queued item immediately', async () =>
    {
        hashFileMock.mockImplementation(() => new Promise<string>(() => undefined));
        const store = useUploadsStore();

        store.enqueue(
            [ 'a', 'b', 'c', 'd' ].map((name) => uploadFile(`${ name }.txt`)),
            null
        );
        await waitFor(() => store.items.filter((item) => item.status !== 'queued').length === 3, 'three active');

        const queued = store.items.find((item) => item.status === 'queued');
        store.cancel(queued?.id ?? '');

        expect(queued?.status).toBe('cancelled');
    });

    it('aborts the in-flight upload when a running item is cancelled', async () =>
    {
        hashFileMock.mockResolvedValue('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockImplementation((options : { signal ?: AbortSignal }) => new Promise((_resolve, reject) =>
        {
            options.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
        }));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'uploading', 'uploading');

        store.cancel(store.items[0]?.id ?? '');
        await waitFor(() => store.items[0]?.status === 'cancelled', 'cancelled');

        expect(store.items[0]?.status).toBe('cancelled');
    });
});

//----------------------------------------------------------------------------------------------------------------------
