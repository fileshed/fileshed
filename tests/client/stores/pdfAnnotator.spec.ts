//----------------------------------------------------------------------------------------------------------------------
// PDF Annotator Store
//
// Drives the load / annotate / save / conflict pipeline with the node and content calls, hashing, and commitFile
// mocked, and the pdf.js boundary standing in as a registered save source that yields known bytes.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { PDF_ANNOTATOR_MAX_BYTES } from '@fileshed/core';

// Resource Access
import { ConflictAPIError } from '@client/resource-access/apiError.ts';
import { getNode, patchNode } from '@client/resource-access/nodes.ts';
import { getNodeBlob } from '@client/resource-access/content.ts';
import { saveBytes, showBytesIn } from '@client/resource-access/downloads.ts';

// Utils
import { hashFile } from '@client/utils/hashFile.ts';

// Stores
import { commitFile } from '@client/stores/commitFile.ts';
import { usePDFAnnotatorStore } from '@client/stores/pdfAnnotator.ts';

// Engines
import type { DocumentProperties, OutlineEntry } from '@client/engines/pdf/types.ts';

// Support
import { fileNode, folderNode } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn(), patchNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ getNodeBlob: vi.fn() }));
vi.mock('@client/stores/commitFile.ts', () => ({ commitFile: vi.fn() }));
vi.mock('@client/resource-access/downloads.ts', () => ({
    downloadURL: vi.fn(() => '/api/nodes/f1/download?disposition=inline'),
    saveBytes: vi.fn(),
    showBytesIn: vi.fn(),
}));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getNodeMock = getNode as unknown as Mock;
const getBlobMock = getNodeBlob as unknown as Mock;
const commitMock = commitFile as unknown as Mock;
const hashFileMock = hashFile as unknown as Mock;
const saveBytesMock = saveBytes as unknown as Mock;
const showBytesInMock = showBytesIn as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function outlineEntry() : OutlineEntry
{
    return { id: '0', title: 'Chapter one', bold: false, italic: false, dest: 'ch1', items: [] };
}

function documentProperties() : DocumentProperties
{
    return {
        title: null,
        author: null,
        subject: null,
        keywords: null,
        creator: null,
        producer: null,
        creationDate: null,
        modificationDate: null,
        version: '1.7',
        pageCount: 3,
        pageSize: 'Letter',
        linearized: false,
    };
}

// Stands in for the live renderer. Every call is recorded so a test can assert the store reached the document at all;
// save and serialize yield fixed bytes, since hashFile is mocked and the byte content never matters to the assertions.
function documentAccess(overrides : Partial<PDFAccessDouble> = {}) : PDFAccessDouble
{
    return {
        save: vi.fn(() => Promise.resolve(new Uint8Array([ 1, 2, 3, 4 ]))),
        serialize: vi.fn(() => Promise.resolve(new Uint8Array([ 5, 6, 7, 8 ]))),
        renderThumbnail: vi.fn(() => Promise.resolve()),
        readAttachment: vi.fn(() => Promise.resolve(null)),
        goToDestination: vi.fn(),
        addImage: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
        ...overrides,
    };
}

interface PDFAccessDouble
{
    save : () => Promise<Uint8Array>;
    serialize : () => Promise<Uint8Array>;
    renderThumbnail : (page : number, canvas : HTMLCanvasElement, width : number) => Promise<void>;
    readAttachment : (id : string) => Promise<Uint8Array | null>;
    goToDestination : (dest : string | unknown[]) => void;
    addImage : () => void;
    undo : () => void;
    redo : () => void;
}

// A store loaded and ready over a PDF file with blob 'b1'. Document access is registered by default, standing in for
// the live renderer: like pdf.js, its save reports the marks clean as it serializes them. Save defaults to a commit
// landing a node whose blob is 'b2'.
async function openReady(
    overrides : Parameters<typeof fileNode>[0] = {},
    withAccess = true
) : Promise<ReturnType<typeof usePDFAnnotatorStore>>
{
    getNodeMock.mockResolvedValue(fileNode(overrides));
    getBlobMock.mockResolvedValue(new Blob([ new Uint8Array([ 37, 80, 68, 70 ]) ]));

    const store = usePDFAnnotatorStore();
    await store.open('f1');

    if(withAccess)
    {
        store.setDocumentAccess(documentAccess({
            save: vi.fn(async () =>
            {
                store.setDirty(false);
                return new Uint8Array([ 1, 2, 3, 4 ]);
            }),
        }));
    }
    return store;
}

beforeEach(() =>
{
    setActivePinia(createPinia());
    vi.clearAllMocks();

    commitMock.mockResolvedValue(fileNode({ blobID: 'b2' }));
    hashFileMock.mockResolvedValue('freshsha');
});

//----------------------------------------------------------------------------------------------------------------------
// Load
//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore.open', () =>
{
    it('lands nothing from an open that a later open overtook', async () =>
    {
        let slowBytes : (blob : Blob) => void = () => undefined;
        getNodeMock
            .mockResolvedValueOnce(fileNode({ id: 'f1', blobID: 'b1' }))
            .mockResolvedValueOnce(fileNode({ id: 'f2', blobID: 'c1' }));
        getBlobMock
            .mockImplementationOnce(() => new Promise((resolve) => { slowBytes = resolve; }))
            .mockResolvedValueOnce(new Blob([ new Uint8Array([ 2 ]) ]));
        const store = usePDFAnnotatorStore();

        const first = store.open('f1');
        await vi.waitFor(() => { expect(getBlobMock).toHaveBeenCalledTimes(1); });
        await store.open('f2');
        slowBytes(new Blob([ new Uint8Array([ 1 ]) ]));
        await first;

        expect(store.node?.id).toBe('f2');
        expect(store.bytes).toEqual(new Uint8Array([ 2 ]));
    });

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
        getNodeMock.mockResolvedValue(folderNode({ id: 'f1' }));

        const store = usePDFAnnotatorStore();
        await store.open('f1');

        expect(store.loadState).toBe('error');
        expect(getBlobMock).not.toHaveBeenCalled();
    });

    it('refuses a PDF over the annotator cap without fetching its bytes', async () =>
    {
        const store = await openReady({ size: PDF_ANNOTATOR_MAX_BYTES + 1 });

        expect(store.loadState).toBe('error');
        expect(getBlobMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Annotation mode
//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore annotation mode', () =>
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

describe('usePDFAnnotatorStore.save', () =>
{
    it('carries the loaded blob as the concurrency guard on the commit', async () =>
    {
        const store = await openReady();

        store.setDirty(true);
        await store.save();

        const commit = commitMock.mock.calls[0]?.[1];
        expect(commit).toEqual({ replaceNodeID: 'f1', ifBlobID: 'b1' });
        expect(store.dirty).toBe(false);
    });

    it('skips the save entirely when the annotated bytes already hash to the stored blob', async () =>
    {
        const store = await openReady();
        hashFileMock.mockResolvedValue('b1'); // the saved document hashes to the blob already on the node

        store.setDirty(true);
        await store.save();

        expect(commitMock).not.toHaveBeenCalled();
        expect(store.dirty).toBe(false);
    });

    // pdf.js raises its modified flag only on the clean-to-modified edge, so a mark made after the save serialized the
    // document is the only signal that mark will ever send.
    it('keeps a mark made while the save was on the wire unsaved', async () =>
    {
        const store = await openReady();
        let land : (node : unknown) => void = () => undefined;
        commitMock.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));

        store.setDirty(true);
        const saving = store.save();
        await vi.waitFor(() => { expect(commitMock).toHaveBeenCalled(); });

        store.setDirty(true);
        land(fileNode({ blobID: 'b2' }));
        await saving;

        expect(store.dirty).toBe(true);
    });

    it('re-arms the guard with the newly written blob on each successful save', async () =>
    {
        const store = await openReady();

        hashFileMock.mockResolvedValueOnce('shaV2').mockResolvedValueOnce('shaV3');
        commitMock
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }))
            .mockResolvedValueOnce(fileNode({ blobID: 'b3' }));

        await store.save();
        await store.save();

        // The first save pinned the loaded blob; the second pinned what the first save wrote.
        expect(commitMock.mock.calls[0]?.[1].ifBlobID).toBe('b1');
        expect(commitMock.mock.calls[1]?.[1].ifBlobID).toBe('b2');
    });

    it('does not save a read-only session', async () =>
    {
        const store = await openReady({ role: 'viewer' });

        store.setDirty(true);
        await store.save();

        expect(commitMock).not.toHaveBeenCalled();
    });

    it('does not save when no live document has registered a save source', async () =>
    {
        const store = await openReady({}, false);

        store.setDirty(true);
        await store.save();

        expect(commitMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Conflict
//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore conflict', () =>
{
    it('raises the conflict state on a 409 and keeps the marks unsaved', async () =>
    {
        const store = await openReady();
        commitMock.mockRejectedValueOnce(
            new ConflictAPIError('The file changed since you opened it.', 'replace.staleBlob')
        );

        store.setDirty(true);
        await store.save();

        expect(store.conflict).toBe(true);
        expect(store.dirty).toBe(true);
    });

    it('overwrite retries the save without the guard and clears the conflict', async () =>
    {
        const store = await openReady();
        commitMock
            .mockRejectedValueOnce(new ConflictAPIError('stale', 'replace.staleBlob'))
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }));

        store.setDirty(true);
        await store.save();
        expect(store.conflict).toBe(true);

        await store.overwrite();

        // The retry drops the ifBlobID guard entirely -- last-write-wins.
        expect(commitMock.mock.calls[1]?.[1]).toEqual({ replaceNodeID: 'f1' });
        expect(store.conflict).toBe(false);
        expect(store.dirty).toBe(false);
    });

    it('reload discards local annotations and restores the server bytes', async () =>
    {
        const store = await openReady();
        commitMock.mockRejectedValueOnce(new ConflictAPIError('stale', 'replace.staleBlob'));

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

describe('usePDFAnnotatorStore rotation', () =>
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

describe('usePDFAnnotatorStore editor params', () =>
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

describe('usePDFAnnotatorStore zoom stepping', () =>
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
        // A fresh session opens at the automatic preset, which has no rung of its own.
        store.zoomIn();

        expect(store.zoom).toBe('1.25');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Page navigation
//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore page navigation', () =>
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

describe('usePDFAnnotatorStore page stepping', () =>
{
    it('steps forward and back a page at a time', async () =>
    {
        const store = await openReady();
        store.setPage(2, 10);

        store.nextPage();
        expect(store.currentPage).toBe(3);

        store.prevPage();
        expect(store.currentPage).toBe(2);
    });

    it('stops at the first page rather than stepping past it', async () =>
    {
        const store = await openReady();
        store.setPage(1, 10);

        store.prevPage();

        expect(store.currentPage).toBe(1);
    });

    it('stops at the last page rather than stepping past it', async () =>
    {
        const store = await openReady();
        store.setPage(10, 10);

        store.nextPage();

        expect(store.currentPage).toBe(10);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore find', () =>
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

        store.toggleFindOption('caseSensitive');

        expect(store.findOptions.caseSensitive).toBe(true);
        expect(store.findRequest).toMatchObject({ query: 'invoice', caseSensitive: true });
    });

    it('carries every search toggle on the dispatched query', async () =>
    {
        const store = await openReady();
        store.setFindQuery('resume');

        store.toggleFindOption('entireWord');
        store.toggleFindOption('matchDiacritics');
        store.toggleFindOption('highlightAll');

        expect(store.findRequest).toMatchObject({
            query: 'resume',
            entireWord: true,
            matchDiacritics: true,
            highlightAll: false,
        });
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

describe('PDFAnnotatorStore.rename', () =>
{
    it('renames the loaded node and adopts the server response', async () =>
    {
        const store = usePDFAnnotatorStore();
        store.node = fileNode({ name: 'contract.pdf' });
        (patchNode as unknown as Mock).mockResolvedValue(fileNode({ name: 'signed.pdf' }));

        await store.rename('  signed.pdf  ');

        expect(store.node?.name).toBe('signed.pdf');
        expect(patchNode).toHaveBeenCalledWith('f1', { name: 'signed.pdf' });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore sidebar', () =>
{
    it('opens the rail when a tab is chosen from a closed one', async () =>
    {
        const store = await openReady();

        store.showSidebarTab('outline');

        expect(store.sidebarOpen).toBe(true);
        expect(store.sidebarTab).toBe('outline');
    });

    it('falls back to thumbnails when the document has nothing behind the open tab', async () =>
    {
        const store = await openReady();
        store.showSidebarTab('outline');

        store.setDocumentFacts({ outline: [], attachments: [], properties: documentProperties() });

        expect(store.sidebarTab).toBe('thumbnails');
    });

    it('leaves the open tab alone when the document has something behind it', async () =>
    {
        const store = await openReady();
        store.showSidebarTab('outline');

        store.setDocumentFacts({ outline: [ outlineEntry() ], attachments: [], properties: documentProperties() });

        expect(store.sidebarTab).toBe('outline');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore layout', () =>
{
    it('clears the layout back to a single vertical column on a fresh load', async () =>
    {
        const store = await openReady();
        store.setScrollMode('wrapped');
        store.setSpreadMode('odd');
        store.setCursorTool('pan');

        await store.open('f1');

        expect(store.scrollMode).toBe('vertical');
        expect(store.spreadMode).toBe('none');
        expect(store.cursorTool).toBe('select');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore editor history', () =>
{
    it('steps the renderer back and forward for an editor', async () =>
    {
        const access = documentAccess();
        const store = await openReady({}, false);
        store.setDocumentAccess(access);

        store.undo();
        store.redo();

        expect(access.undo).toHaveBeenCalledTimes(1);
        expect(access.redo).toHaveBeenCalledTimes(1);
    });

    it('places an image and arms the tool, since a click on the page never makes one', async () =>
    {
        const access = documentAccess();
        const store = await openReady({}, false);
        store.setDocumentAccess(access);

        store.addImage();

        expect(access.addImage).toHaveBeenCalledTimes(1);
        expect(store.mode).toBe('stamp');
    });

    it('places a second image on a second press rather than sitting inert', async () =>
    {
        const access = documentAccess();
        const store = await openReady({}, false);
        store.setDocumentAccess(access);

        store.addImage();
        store.addImage();

        expect(access.addImage).toHaveBeenCalledTimes(2);
    });

    it('refuses to place an image in a read-only session', async () =>
    {
        const access = documentAccess();
        const store = await openReady({ role: 'viewer' }, false);
        store.setDocumentAccess(access);

        store.addImage();

        expect(access.addImage).not.toHaveBeenCalled();
        expect(store.mode).toBe('none');
    });

    it('refuses to step a read-only session, which has no marks of its own to step through', async () =>
    {
        const access = documentAccess();
        const store = await openReady({ role: 'viewer' }, false);
        store.setDocumentAccess(access);

        store.undo();
        store.redo();

        expect(access.undo).not.toHaveBeenCalled();
        expect(access.redo).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore alt text', () =>
{
    it('opens the dialog on the description the annotation already carries', async () =>
    {
        const store = await openReady();

        store.openAltText({ altText: 'A bar chart', decorative: false, apply: vi.fn() });

        expect(store.altTextOpen).toBe(true);
        expect(store.altText).toBe('A bar chart');
        expect(store.altTextDecorative).toBe(false);
    });

    it('hands the description back to the annotation that asked', async () =>
    {
        const apply = vi.fn();
        const store = await openReady();
        store.openAltText({ altText: '', decorative: false, apply });

        store.saveAltText('  A bar chart  ', false);

        expect(apply).toHaveBeenCalledWith('A bar chart', false);
        expect(store.altTextOpen).toBe(false);
    });

    it('saves a decorative image with no description, since it states there is nothing to read', async () =>
    {
        const apply = vi.fn();
        const store = await openReady();
        store.openAltText({ altText: 'left over', decorative: false, apply });

        store.saveAltText('left over', true);

        expect(apply).toHaveBeenCalledWith('', true);
    });

    it('changes nothing when the dialog is closed without saving', async () =>
    {
        const apply = vi.fn();
        const store = await openReady();
        store.openAltText({ altText: 'A bar chart', decorative: false, apply });

        store.closeAltText();

        expect(apply).not.toHaveBeenCalled();
        expect(store.altTextOpen).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore attachments', () =>
{
    it('saves the bytes the renderer holds for an embedded file', async () =>
    {
        const content = new Uint8Array([ 9, 9, 9 ]);
        const store = await openReady({}, false);
        store.setDocumentAccess(documentAccess({ readAttachment: vi.fn(() => Promise.resolve(content)) }));

        await store.saveAttachment('a0', 'appendix.csv');

        expect(saveBytesMock).toHaveBeenCalledWith(content, 'appendix.csv', 'application/octet-stream');
    });

    it('saves nothing for an attachment the renderer cannot read', async () =>
    {
        const store = await openReady();

        await store.saveAttachment('nope', 'missing.csv');

        expect(saveBytesMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('usePDFAnnotatorStore print', () =>
{
    it('hands the tab the annotated document without declaring the marks saved', async () =>
    {
        const target = {} as Window;
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(target);
        const access = documentAccess();
        const store = await openReady({}, false);
        store.setDocumentAccess(access);
        store.setDirty(true);

        await store.print();

        expect(access.serialize).toHaveBeenCalledTimes(1);
        expect(access.save).not.toHaveBeenCalled();
        expect(showBytesInMock).toHaveBeenCalledWith(target, new Uint8Array([ 5, 6, 7, 8 ]), 'application/pdf');
        expect(store.dirty).toBe(true);

        openSpy.mockRestore();
    });

    it('reports a blocked pop-up rather than failing silently', async () =>
    {
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
        const store = await openReady();

        await store.print();

        expect(store.printError).toMatch(/pop-ups/i);
        expect(showBytesInMock).not.toHaveBeenCalled();

        openSpy.mockRestore();
    });
});

//----------------------------------------------------------------------------------------------------------------------
