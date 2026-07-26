//----------------------------------------------------------------------------------------------------------------------
// PDF Annotator Store
//
// Drives the load / annotate / save / conflict pipeline with the resource-access, hashing, and proof seams mocked, and
// the pdf.js boundary standing in as a registered save source that yields known bytes. Each test asserts an observable
// outcome -- the bytes and read-only state after a load, the guard carried on the commit, the no-op when the annotated
// bytes already hash to the stored blob, the conflict a 409 raises, the guard dropped on an overwrite -- never merely
// that a mock was called. Expectations come from the store's contract, not its internals.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { type NodeResponse, PDF_ANNOTATOR_MAX_BYTES, type Role } from '@fileshed/core';

// Resource Access
import { ApiError } from '@client/resource-access/apiError.ts';
import { getNode, patchNode } from '@client/resource-access/nodes.ts';
import { fetchNodeBlob } from '@client/resource-access/content.ts';
import { answerChallenge, claimBlob, uploadTicket } from '@client/resource-access/blobs.ts';

// Engines
import { computeProofAnswer } from '@client/engines/claim.ts';

// Utils
import { hashFile, readSampleWindows } from '@client/utils/hashFile.ts';

// Stores
import { usePdfAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn(), patchNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeBlob: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    uploadTicket: vi.fn(),
    answerChallenge: vi.fn(),
}));
vi.mock('@client/engines/claim.ts', () => ({ computeProofAnswer: vi.fn() }));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getNodeMock = getNode as unknown as Mock;
const fetchBlobMock = fetchNodeBlob as unknown as Mock;
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
        id: overrides.id ?? 'f1',
        name: overrides.name ?? 'contract.pdf',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: overrides.role ?? 'owner',
        type: 'file',
        blobID: overrides.blobID ?? 'b1',
        size: overrides.size ?? 2048,
        mimeType: overrides.mimeType ?? 'application/pdf',
        trashedAt: null,
    };
}

// A store loaded and ready over a PDF file with blob 'b1'. A save source is registered by default, standing in for the
// live renderer's saveDocument -- it yields fixed bytes, since hashFile is mocked and the byte content never matters to
// the assertions. Save defaults to a fresh-content ticket commit landing a node whose blob is 'b2'.
async function openReady(
    overrides : Parameters<typeof fileNode>[0] = {},
    withSaveSource = true
) : Promise<ReturnType<typeof usePdfAnnotatorStore>>
{
    getNodeMock.mockResolvedValue(fileNode(overrides));
    fetchBlobMock.mockResolvedValue(new Blob([ new Uint8Array([ 37, 80, 68, 70 ]) ]));

    const store = usePdfAnnotatorStore();
    await store.open('f1');

    if(withSaveSource) { store.setSaveSource(() => Promise.resolve(new Uint8Array([ 1, 2, 3, 4 ]))); }
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

describe('usePdfAnnotatorStore.open', () =>
{
    it('loads a PDF into a ready session an owner can annotate', async () =>
    {
        const store = await openReady();

        expect(store.loadState).toBe('ready');
        expect(store.bytes).not.toBeNull();
        expect(store.readOnly).toBe(false);
        expect(store.dirty).toBe(false);
    });

    it('opens a PDF shared read-only to a viewer as read-only', async () =>
    {
        const store = await openReady({ role: 'viewer' });

        expect(store.loadState).toBe('ready');
        expect(store.readOnly).toBe(true);
    });

    it('lets an editor (not just the owner) annotate', async () =>
    {
        const store = await openReady({ role: 'editor' });

        expect(store.readOnly).toBe(false);
    });

    it('refuses a node that is not a file', async () =>
    {
        getNodeMock.mockResolvedValue({ ...fileNode(), type: 'folder' });

        const store = usePdfAnnotatorStore();
        await store.open('f1');

        expect(store.loadState).toBe('error');
        expect(fetchBlobMock).not.toHaveBeenCalled();
    });

    it('refuses a PDF over the annotator cap without fetching its bytes', async () =>
    {
        const store = await openReady({ size: PDF_ANNOTATOR_MAX_BYTES + 1 });

        expect(store.loadState).toBe('error');
        expect(fetchBlobMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Annotation mode
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore annotation mode', () =>
{
    it('starts a fresh session in select mode', async () =>
    {
        const store = await openReady();

        expect(store.mode).toBe('none');
    });

    it('switches to a chosen annotation tool', async () =>
    {
        const store = await openReady();

        store.setMode('ink');

        expect(store.mode).toBe('ink');
    });

    it('keeps a read-only session in select mode when a tool is requested', async () =>
    {
        const store = await openReady({ role: 'viewer' });

        store.setMode('highlight');

        expect(store.mode).toBe('none');
    });

    it('resets to select mode on reload', async () =>
    {
        const store = await openReady();
        store.setMode('freetext');

        await store.reload();

        expect(store.mode).toBe('none');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Save
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore.save', () =>
{
    it('carries the loaded blob as the concurrency guard on the commit', async () =>
    {
        const store = await openReady();

        store.setDirty(true);
        await store.save();

        const commit = uploadTicketMock.mock.calls[0][2];
        expect(commit).toEqual({ replaceNodeID: 'f1', ifBlobID: 'b1' });
        expect(store.dirty).toBe(false);
    });

    it('skips the save entirely when the annotated bytes already hash to the stored blob', async () =>
    {
        const store = await openReady();
        hashFileMock.mockResolvedValue('b1'); // the saved document hashes to the blob already on the node

        store.setDirty(true);
        await store.save();

        expect(claimBlobMock).not.toHaveBeenCalled();
        expect(uploadTicketMock).not.toHaveBeenCalled();
        expect(store.dirty).toBe(false);
    });

    it('saves a known blob through the proof-of-possession path, carrying the guard', async () =>
    {
        const store = await openReady();
        claimBlobMock.mockResolvedValue({ upload: false, challengeID: 'c1', nonce: 'n1', ranges: [ [ 0, 4 ] ] });

        store.setDirty(true);
        await store.save();

        expect(uploadTicketMock).not.toHaveBeenCalled();
        expect(answerChallengeMock).toHaveBeenCalledWith('c1', {
            answer: 'proof-answer',
            replaceNodeID: 'f1',
            ifBlobID: 'b1',
        });
    });

    it('re-arms the guard with the newly written blob on each successful save', async () =>
    {
        const store = await openReady();

        hashFileMock.mockResolvedValueOnce('shaV2').mockResolvedValueOnce('shaV3');
        uploadTicketMock
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }))
            .mockResolvedValueOnce(fileNode({ blobID: 'b3' }));

        await store.save();
        await store.save();

        // The first save pinned the loaded blob; the second pinned what the first save wrote.
        expect(uploadTicketMock.mock.calls[0][2].ifBlobID).toBe('b1');
        expect(uploadTicketMock.mock.calls[1][2].ifBlobID).toBe('b2');
    });

    it('does not save a read-only session', async () =>
    {
        const store = await openReady({ role: 'viewer' });

        store.setDirty(true);
        await store.save();

        expect(claimBlobMock).not.toHaveBeenCalled();
    });

    it('does not save when no live document has registered a save source', async () =>
    {
        const store = await openReady({}, false);

        store.setDirty(true);
        await store.save();

        expect(claimBlobMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Conflict
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore conflict', () =>
{
    it('raises the conflict state on a 409 and keeps the marks unsaved', async () =>
    {
        const store = await openReady();
        uploadTicketMock.mockRejectedValueOnce(new ApiError(409, 'The file changed since you opened it.'));

        store.setDirty(true);
        await store.save();

        expect(store.conflict).toBe(true);
        expect(store.dirty).toBe(true);
    });

    it('overwrite retries the save without the guard and clears the conflict', async () =>
    {
        const store = await openReady();
        uploadTicketMock
            .mockRejectedValueOnce(new ApiError(409, 'stale'))
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }));

        store.setDirty(true);
        await store.save();
        expect(store.conflict).toBe(true);

        await store.overwrite();

        // The retry drops the ifBlobID guard entirely -- last-write-wins.
        expect(uploadTicketMock.mock.calls[1][2]).toEqual({ replaceNodeID: 'f1' });
        expect(store.conflict).toBe(false);
        expect(store.dirty).toBe(false);
    });

    it('reload discards local annotations and restores the server bytes', async () =>
    {
        const store = await openReady();
        uploadTicketMock.mockRejectedValueOnce(new ApiError(409, 'stale'));

        store.setDirty(true);
        await store.save();
        expect(store.conflict).toBe(true);

        await store.reload();

        expect(store.conflict).toBe(false);
        expect(store.dirty).toBe(false);
        expect(store.loadState).toBe('ready');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Rotation
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore rotation', () =>
{
    it('starts un-rotated', async () =>
    {
        const store = await openReady();

        expect(store.rotation).toBe(0);
    });

    it('rotates clockwise in ninety-degree quarters, wrapping a full turn back to zero', async () =>
    {
        const store = await openReady();

        store.rotateCW();
        expect(store.rotation).toBe(90);
        store.rotateCW();
        expect(store.rotation).toBe(180);
        store.rotateCW();
        expect(store.rotation).toBe(270);
        store.rotateCW();
        expect(store.rotation).toBe(0);
    });

    it('rotates counter-clockwise, wrapping past zero to 270', async () =>
    {
        const store = await openReady();

        store.rotateCCW();

        expect(store.rotation).toBe(270);
    });

    it('clears rotation back to zero on reload', async () =>
    {
        const store = await openReady();
        store.rotateCW();

        await store.reload();

        expect(store.rotation).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Editor parameters
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore editor params', () =>
{
    it('starts with pdf.js\'s own editor defaults', async () =>
    {
        const store = await openReady();

        expect(store.editorParams).toEqual({
            highlight: { color: '#FFFF98', thickness: 12, showAll: true },
            text: { color: '#000000', size: 10 },
            ink: { color: '#000000', thickness: 3, opacity: 100 },
        });
    });

    it('patches one highlight param without disturbing the rest', async () =>
    {
        const store = await openReady();

        store.updateHighlight({ color: '#53FFBC' });

        expect(store.editorParams.highlight).toEqual({ color: '#53FFBC', thickness: 12, showAll: true });
    });

    it('patches text and ink params independently', async () =>
    {
        const store = await openReady();

        store.updateText({ size: 24 });
        store.updateInk({ thickness: 8, opacity: 50 });

        expect(store.editorParams.text).toEqual({ color: '#000000', size: 24 });
        expect(store.editorParams.ink).toEqual({ color: '#000000', thickness: 8, opacity: 50 });
    });

    it('restores default params on reload', async () =>
    {
        const store = await openReady();
        store.updateHighlight({ color: '#FF4F5F', thickness: 20 });

        await store.reload();

        expect(store.editorParams.highlight).toEqual({ color: '#FFFF98', thickness: 12, showAll: true });
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Zoom stepping
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore zoom stepping', () =>
{
    it('steps up one absolute rung', async () =>
    {
        const store = await openReady();
        store.setZoom('1');

        store.zoomIn();

        expect(store.zoom).toBe('1.25');
    });

    it('steps down one absolute rung', async () =>
    {
        const store = await openReady();
        store.setZoom('1');

        store.zoomOut();

        expect(store.zoom).toBe('0.75');
    });

    it('clamps zoom-in at the top rung', async () =>
    {
        const store = await openReady();
        store.setZoom('2');

        store.zoomIn();

        expect(store.zoom).toBe('2');
    });

    it('clamps zoom-out at the bottom rung', async () =>
    {
        const store = await openReady();
        store.setZoom('0.5');

        store.zoomOut();

        expect(store.zoom).toBe('0.5');
    });

    it('steps from a fit preset as if it were 100%', async () =>
    {
        const store = await openReady();
        // A fresh session opens at the page-width fit preset, which has no rung of its own.
        store.zoomIn();

        expect(store.zoom).toBe('1.25');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Page navigation
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore page navigation', () =>
{
    it('clamps a jump past the last page to the last page', async () =>
    {
        const store = await openReady();
        store.setPage(1, 10);

        store.goToPage(99);

        expect(store.currentPage).toBe(10);
        expect(store.pageRequest?.page).toBe(10);
    });

    it('clamps a jump below the first page to page one', async () =>
    {
        const store = await openReady();
        store.setPage(5, 10);

        store.goToPage(0);
        expect(store.currentPage).toBe(1);

        store.goToPage(-4);
        expect(store.currentPage).toBe(1);
    });

    it('rounds a fractional page to the nearest whole page', async () =>
    {
        const store = await openReady();
        store.setPage(1, 10);

        store.goToPage(3.7);

        expect(store.currentPage).toBe(4);
    });

    it('ignores a non-numeric jump', async () =>
    {
        const store = await openReady();
        store.setPage(3, 10);

        store.goToPage(Number.NaN);

        expect(store.currentPage).toBe(3);
        expect(store.pageRequest).toBeNull();
    });

    it('jumps to the first and last pages', async () =>
    {
        const store = await openReady();
        store.setPage(5, 10);

        store.firstPage();
        expect(store.currentPage).toBe(1);

        store.lastPage();
        expect(store.currentPage).toBe(10);
    });

    it('re-issues a jump to the page already shown via a fresh command nonce', async () =>
    {
        const store = await openReady();
        store.setPage(4, 10);

        store.goToPage(4);
        const first = store.pageRequest?.seq;
        store.goToPage(4);
        const second = store.pageRequest?.seq;

        expect(first).not.toBe(second);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Find
//----------------------------------------------------------------------------------------------------------------------

describe('usePdfAnnotatorStore find', () =>
{
    it('opens the find bar', async () =>
    {
        const store = await openReady();

        store.openFind();

        expect(store.findOpen).toBe(true);
    });

    it('issues a fresh search for a typed query', async () =>
    {
        const store = await openReady();

        store.setFindQuery('invoice');

        expect(store.findQuery).toBe('invoice');
        expect(store.findRequest).toMatchObject({
            query: 'invoice',
            caseSensitive: false,
            highlightAll: true,
            findPrevious: false,
            again: false,
        });
    });

    it('clears the search and tally when the query is emptied', async () =>
    {
        const store = await openReady();
        store.setFindQuery('invoice');
        store.setFindResult(1, 3);

        store.setFindQuery('');

        expect(store.findRequest).toBeNull();
        expect(store.findCurrent).toBe(0);
        expect(store.findTotal).toBe(0);
    });

    it('walks to the next match as a repeat search over the same term', async () =>
    {
        const store = await openReady();
        store.setFindQuery('invoice');
        const firstSeq = store.findRequest?.seq;

        store.findNext();

        expect(store.findRequest).toMatchObject({ query: 'invoice', again: true, findPrevious: false });
        expect(store.findRequest?.seq).not.toBe(firstSeq);
    });

    it('walks to the previous match backward over the same term', async () =>
    {
        const store = await openReady();
        store.setFindQuery('invoice');

        store.findPrev();

        expect(store.findRequest).toMatchObject({ again: true, findPrevious: true });
    });

    it('does not walk matches when there is no query', async () =>
    {
        const store = await openReady();

        store.findNext();

        expect(store.findRequest).toBeNull();
    });

    it('re-runs the search with the new sensitivity when case is toggled', async () =>
    {
        const store = await openReady();
        store.setFindQuery('invoice');

        store.toggleFindCase();

        expect(store.findCaseSensitive).toBe(true);
        expect(store.findRequest).toMatchObject({ query: 'invoice', caseSensitive: true });
    });

    it('records the match tally the renderer reports', async () =>
    {
        const store = await openReady();

        store.setFindResult(2, 5);

        expect(store.findCurrent).toBe(2);
        expect(store.findTotal).toBe(5);
    });

    it('closing the find bar clears the query, tally, and search', async () =>
    {
        const store = await openReady();
        store.openFind();
        store.setFindQuery('invoice');
        store.setFindResult(1, 4);

        store.closeFind();

        expect(store.findOpen).toBe(false);
        expect(store.findQuery).toBe('');
        expect(store.findCurrent).toBe(0);
        expect(store.findTotal).toBe(0);
        expect(store.findRequest).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('PdfAnnotatorStore.rename', () =>
{
    it('renames the loaded node and adopts the server response', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.node = fileNode({ name: 'contract.pdf' });
        (patchNode as unknown as Mock).mockResolvedValue(fileNode({ name: 'signed.pdf' }));

        await store.rename('  signed.pdf  ');

        expect(store.node?.name).toBe('signed.pdf');
        expect(patchNode).toHaveBeenCalledWith('f1', { name: 'signed.pdf' });
    });

    it('refuses to rename a read-only session', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.node = fileNode({ name: 'contract.pdf', role: 'viewer' });

        await store.rename('renamed.pdf');

        expect(store.node?.name).toBe('contract.pdf');
        expect(patchNode).not.toHaveBeenCalled();
    });

    it('ignores blank and unchanged names', async () =>
    {
        const store = usePdfAnnotatorStore();
        store.node = fileNode({ name: 'contract.pdf' });

        await store.rename('   ');
        await store.rename('contract.pdf');

        expect(store.node?.name).toBe('contract.pdf');
        expect(patchNode).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
