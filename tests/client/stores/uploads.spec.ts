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
import { readDroppedPayload } from '@client/resource-access/droppedEntries.ts';
import { createNode, getChildren } from '@client/resource-access/nodes.ts';
import { answerChallenge, claimBlob } from '@client/resource-access/blobs.ts';
import { uploadWithProgress } from '@client/resource-access/uploadWithProgress.ts';
import { fetchMe } from '@client/resource-access/me.ts';

// Utils
import { hashFile, readSampleWindows } from '@client/utils/hashFile.ts';

// Stores
import { useAppStore } from '@client/stores/app.ts';
import { useDriveStore } from '@client/stores/drive.ts';
import { useSessionStore } from '@client/stores/session.ts';
import { useUploadsStore } from '@client/stores/uploads.ts';

// Support
import { meFixture } from '../support.ts';

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

vi.mock('@client/resource-access/droppedEntries.ts', () => ({ readDroppedPayload: vi.fn() }));

vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));

vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getChildrenMock = getChildren as unknown as Mock;
const createNodeMock = createNode as unknown as Mock;
const readDroppedPayloadMock = readDroppedPayload as unknown as Mock;
const claimBlobMock = claimBlob as unknown as Mock;
const answerChallengeMock = answerChallenge as unknown as Mock;
const uploadMock = uploadWithProgress as unknown as Mock;
const hashFileMock = hashFile as unknown as Mock;
const readWindowsMock = readSampleWindows as unknown as Mock;
const fetchMeMock = fetchMe as unknown as Mock;

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

function folderNode(id : string, name : string) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

// The standard happy-path pipeline mocks: fresh blob, no collisions, ticket upload lands.
function mockHappyPipeline() : void
{
    hashFileMock.mockResolvedValue('sha-1');
    getChildrenMock.mockResolvedValue(listing(0));
    claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
    uploadMock.mockResolvedValue(fileNode('n1'));
}

// Polling is bounded by a wall clock, not a turn count: the proof-of-possession answer goes through real WebCrypto,
// whose completion lands whenever the platform's threadpool gets to it, while a spin of empty event-loop turns burns
// hundreds of turns in a millisecond. The deadline stays under Vitest's own timeout, so a pipeline that really is
// stuck still fails naming what it waited for.
const SETTLE_TIMEOUT_MS = 2000;

async function waitFor(predicate : () => boolean, label = 'condition') : Promise<void>
{
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;

    do
    {
        if(predicate()) { return; }

        // eslint-disable-next-line no-await-in-loop -- polling the async pipeline forward one event-loop turn at a time
        await flushPromises();
    }
    while(Date.now() < deadline);

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

    it('refreshes the session quota when an upload lands, so the gauge moves', async () =>
    {
        mockHappyPipeline();
        const refreshedProfile = meFixture({ quota: { used: 4096, effective: 10_000, limit: 10_000 } });
        fetchMeMock.mockResolvedValue(refreshedProfile);

        const store = useUploadsStore();
        store.enqueue([ uploadFile('report.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'done', 'done');
        await waitFor(() => useSessionStore().me?.quota.used === 4096, 'quota adopted');

        expect(useSessionStore().me?.quota).toEqual({ used: 4096, effective: 10_000, limit: 10_000 });
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
    // Batch windows -- a new batch started when nothing is running opens a clean panel; rows join an existing
    // window only while it still has active items.
    //------------------------------------------------------------------------------------------------------------------

    it('drops the finished history when a new batch starts after everything settled', async () =>
    {
        mockHappyPipeline();
        const store = useUploadsStore();

        store.enqueue([ uploadFile('first.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'done', 'first done');

        store.enqueue([ uploadFile('second.txt') ], null);
        await waitFor(() => store.items.every((item) => item.status === 'done'), 'second done');

        expect(store.items.map((item) => item.name)).toEqual([ 'second.txt' ]);
    });

    it('drops a previous batch\'s error rows too -- they are history once a new batch begins', async () =>
    {
        hashFileMock.mockResolvedValueOnce('sha-1');
        getChildrenMock.mockResolvedValue(listing(0));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TKT' });
        uploadMock.mockRejectedValueOnce(new ApiError(403, 'You are over your storage quota.'));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('too-big.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'error', 'error');

        hashFileMock.mockResolvedValue('sha-2');
        uploadMock.mockResolvedValue(fileNode('n2'));
        store.enqueue([ uploadFile('fits.txt') ], null);
        await waitFor(() => store.items.every((item) => item.status === 'done'), 'second done');

        expect(store.items.map((item) => item.name)).toEqual([ 'fits.txt' ]);
    });

    it('joins the window of a batch that is still running instead of wiping it', async () =>
    {
        const releases : ((sha : string) => void)[] = [];
        hashFileMock.mockImplementation(() => new Promise<string>((resolve) => { releases.push(resolve); }));
        const store = useUploadsStore();

        store.enqueue([ uploadFile('running.txt') ], null);
        await waitFor(() => store.items[0]?.status === 'hashing', 'first hashing');

        store.enqueue([ uploadFile('joined.txt') ], null);

        expect(store.items.map((item) => item.name)).toEqual([ 'running.txt', 'joined.txt' ]);
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

    //------------------------------------------------------------------------------------------------------------------
    // Folder uploads -- each folder is created (or merged into a same-named sibling) before its files enqueue, and a
    // folder that can't be created surfaces as an error row instead of vanishing.
    //------------------------------------------------------------------------------------------------------------------

    it('creates the dropped tree\'s folders and lands each file inside its own folder', async () =>
    {
        mockHappyPipeline();
        createNodeMock
            .mockResolvedValueOnce(folderNode('dir-music', 'Music'))
            .mockResolvedValueOnce(folderNode('dir-albums', 'Albums'));

        const store = useUploadsStore();
        await store.enqueuePayload({
            files: [ uploadFile('loose.txt') ],
            folders: [ {
                name: 'Music',
                files: [ uploadFile('one.mp3') ],
                folders: [ { name: 'Albums', files: [ uploadFile('two.mp3') ], folders: [] } ],
            } ],
        }, 'root-folder');
        await waitFor(() => store.items.every((item) => item.status === 'done'), 'all done');

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'folder', name: 'Music', parentID: 'root-folder' });
        expect(createNodeMock).toHaveBeenCalledWith({ type: 'folder', name: 'Albums', parentID: 'dir-music' });

        const placements = store.items.map((item) => [ item.name, item.folderID ]);
        expect(placements).toEqual([
            [ 'loose.txt', 'root-folder' ],
            [ 'one.mp3', 'dir-music' ],
            [ 'two.mp3', 'dir-albums' ],
        ]);
    });

    it('merges into an existing same-named folder instead of minting a duplicate', async () =>
    {
        mockHappyPipeline();
        getChildrenMock.mockImplementation((parentID : string | null, query : { name ?: string } = {}) =>
        {
            return Promise.resolve(query.name === 'Music'
                ? { nodes: [ folderNode('dir-existing', 'Music') ], total: 1, limit: 1, offset: 0, owners: [] }
                : listing(0));
        });

        const store = useUploadsStore();
        await store.enqueuePayload({
            files: [],
            folders: [ { name: 'Music', files: [ uploadFile('one.mp3') ], folders: [] } ],
        }, null);
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(store.items[0]?.folderID).toBe('dir-existing');
        expect(createNodeMock).not.toHaveBeenCalled();
    });

    it('surfaces an uncreatable folder as an error row naming it, skipping what was inside', async () =>
    {
        mockHappyPipeline();
        createNodeMock.mockRejectedValue(new ApiError(403, 'read only'));

        const store = useUploadsStore();
        await store.enqueuePayload({
            files: [],
            folders: [ { name: 'Music', files: [ uploadFile('one.mp3') ], folders: [] } ],
        }, null);

        expect(store.items).toHaveLength(1);
        expect(store.items[0]?.status).toBe('error');
        expect(store.items[0]?.name).toBe('Music');
        expect(store.items[0]?.error).toContain('nothing inside it was uploaded');
    });

    it('falls back to a plain multi-file enqueue when a drop carries no entry handles', async () =>
    {
        mockHappyPipeline();

        const store = useUploadsStore();
        await store.enqueueDropped([], [ uploadFile('plain.txt') ], 'folder1');
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(readDroppedPayloadMock).not.toHaveBeenCalled();
        expect(store.items[0]?.folderID).toBe('folder1');
    });

    it('routes a drop with entry handles through traversal into the folder pipeline', async () =>
    {
        mockHappyPipeline();
        createNodeMock.mockResolvedValue(folderNode('dir-music', 'Music'));
        readDroppedPayloadMock.mockResolvedValue({
            files: [],
            folders: [ { name: 'Music', files: [ uploadFile('one.mp3') ], folders: [] } ],
        });

        const store = useUploadsStore();
        await store.enqueueDropped([ { isFile: false, isDirectory: true } as FileSystemEntry ], [], null);
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(store.items[0]?.name).toBe('one.mp3');
        expect(store.items[0]?.folderID).toBe('dir-music');
    });

    //------------------------------------------------------------------------------------------------------------------
    // Upload cap -- the instance limit is knowable before any bytes move, so an oversized file is refused up front
    // rather than hashed and turned away at the claim.
    //------------------------------------------------------------------------------------------------------------------

    function capUploadsAt(maxBytes : number) : void
    {
        useAppStore().limits = { uploadMaxBytes: maxBytes, avatarMaxBytes: 2_000_000 };
    }

    it('refuses a file over the instance cap without hashing or claiming it', async () =>
    {
        mockHappyPipeline();
        capUploadsAt(1000);

        const store = useUploadsStore();
        store.enqueue([ uploadFile('big.bin', 2000) ], null);
        await flushPromises();

        expect(store.items[0]?.status).toBe('error');
        expect(hashFileMock).not.toHaveBeenCalled();
        expect(claimBlobMock).not.toHaveBeenCalled();
        expect(uploadMock).not.toHaveBeenCalled();
    });

    it('names the file and the cap on the refusal', async () =>
    {
        capUploadsAt(1000);

        const store = useUploadsStore();
        store.enqueue([ uploadFile('big.bin', 2000) ], null);
        await flushPromises();

        expect(store.items[0]?.error).toContain('big.bin');
        expect(store.items[0]?.error).toContain('1 kB');
    });

    it('lets a file exactly at the cap through', async () =>
    {
        mockHappyPipeline();
        capUploadsAt(1000);

        const store = useUploadsStore();
        store.enqueue([ uploadFile('exact.bin', 1000) ], null);
        await waitFor(() => store.items[0]?.status === 'done', 'done');

        expect(store.items[0]?.status).toBe('done');
    });

    it('refuses an oversized file inside a dropped folder as well', async () =>
    {
        mockHappyPipeline();
        createNodeMock.mockResolvedValue(folderNode('dir-1', 'Clips'));
        capUploadsAt(1000);

        const store = useUploadsStore();
        await store.enqueuePayload({
            files: [],
            folders: [ { name: 'Clips', files: [ uploadFile('huge.mov', 5000) ], folders: [] } ],
        }, null);
        await flushPromises();

        expect(store.items[0]?.status).toBe('error');
        expect(claimBlobMock).not.toHaveBeenCalled();
    });

    it('lets a retry through once the cap has been raised', async () =>
    {
        mockHappyPipeline();
        capUploadsAt(1000);

        const store = useUploadsStore();
        store.enqueue([ uploadFile('big.bin', 2000) ], null);
        await flushPromises();

        const itemID = store.items[0]?.id ?? '';
        expect(store.items[0]?.status).toBe('error');

        capUploadsAt(5000);
        store.retry(itemID);
        await waitFor(() => store.items[0]?.status === 'done', 'done after the cap rose');

        expect(store.items[0]?.error).toBe(null);
    });

    it('keeps refusing a retry while the file is still over the cap', async () =>
    {
        mockHappyPipeline();
        capUploadsAt(1000);

        const store = useUploadsStore();
        store.enqueue([ uploadFile('big.bin', 2000) ], null);
        await flushPromises();

        store.retry(store.items[0]?.id ?? '');
        await flushPromises();

        expect(store.items[0]?.status).toBe('error');
        expect(hashFileMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
