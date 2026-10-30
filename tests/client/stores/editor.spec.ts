//----------------------------------------------------------------------------------------------------------------------
// Editor Store
//
// Drives the load / edit / save / conflict pipeline with the node and content calls, hashing, and commitFile mocked.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Resource Access
import { ConflictAPIError } from '@client/resource-access/apiError.ts';
import { getNode, patchNode } from '@client/resource-access/nodes.ts';
import { getNodeText } from '@client/resource-access/content.ts';

// Utils
import { hashFile } from '@client/utils/hashFile.ts';

// Stores
import { commitFile } from '@client/stores/commitFile.ts';
import { useEditorStore } from '@client/stores/editor.ts';

// Support
import { fileNode } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn(), patchNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ getNodeText: vi.fn() }));
vi.mock('@client/stores/commitFile.ts', () => ({ commitFile: vi.fn() }));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const getNodeMock = getNode as unknown as Mock;
const getTextMock = getNodeText as unknown as Mock;
const commitMock = commitFile as unknown as Mock;
const hashFileMock = hashFile as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

// A store loaded and ready over a file with blob 'b1' and the text 'hello'. Save defaults to a commit landing a node
// whose blob is 'b2'; individual tests override the pieces they exercise.
async function openReady(overrides : Parameters<typeof fileNode>[0] = {}) : Promise<ReturnType<typeof useEditorStore>>
{
    getNodeMock.mockResolvedValue(fileNode(overrides));
    getTextMock.mockResolvedValue('hello');

    const store = useEditorStore();
    await store.open('f1');
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

describe('useEditorStore.open', () =>
{
    it('lands nothing from an open that a later open overtook', async () =>
    {
        let slowText : (text : string) => void = () => undefined;
        getNodeMock
            .mockResolvedValueOnce(fileNode({ id: 'f1', blobID: 'b1' }))
            .mockResolvedValueOnce(fileNode({ id: 'f2', blobID: 'c1' }));
        getTextMock
            .mockImplementationOnce(() => new Promise((resolve) => { slowText = resolve; }))
            .mockResolvedValueOnce('second file');
        const store = useEditorStore();

        const first = store.open('f1');
        await vi.waitFor(() => { expect(getTextMock).toHaveBeenCalledTimes(1); });
        await store.open('f2');
        slowText('first file');
        await first;

        expect(store.node?.id).toBe('f2');
        expect(store.buffer).toBe('second file');
        expect(store.dirty).toBe(false);
    });

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
        expect(getTextMock).not.toHaveBeenCalled();
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
            expect(commitMock).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(2000);

            // Exactly one save for the whole burst.
            expect(commitMock).toHaveBeenCalledTimes(1);
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

            expect(commitMock).not.toHaveBeenCalled();
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

            expect(commitMock).toHaveBeenCalledTimes(1);

            // The debounce that the edit armed must have been cancelled by the explicit save.
            await vi.advanceTimersByTimeAsync(2000);
            expect(commitMock).toHaveBeenCalledTimes(1);
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

        expect(commitMock).not.toHaveBeenCalled();
        expect(store.dirty).toBe(false);
    });

    it('carries the loaded blob as the concurrency guard on the commit', async () =>
    {
        const store = await openReady();

        store.setBuffer('new content');
        await store.save();

        const commit = commitMock.mock.calls[0]?.[1];
        expect(commit).toEqual({ replaceNodeID: 'f1', ifBlobID: 'b1' });
        expect(store.dirty).toBe(false);
    });

    it('re-arms the guard with the newly written blob on each successful save', async () =>
    {
        const store = await openReady();

        hashFileMock.mockResolvedValueOnce('shaV2').mockResolvedValueOnce('shaV3');
        commitMock
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }))
            .mockResolvedValueOnce(fileNode({ blobID: 'b3' }));

        store.setBuffer('v2');
        await store.save();

        store.setBuffer('v3');
        await store.save();

        // The first save pinned the loaded blob; the second pinned what the first save wrote.
        expect(commitMock.mock.calls[0]?.[1].ifBlobID).toBe('b1');
        expect(commitMock.mock.calls[1]?.[1].ifBlobID).toBe('b2');
    });

    // A save can still be on the wire when the reader leaves the file and opens another. Once it lands, the
    // convergence loop must not go on to write the new file's text onto the old node.
    it('writes nothing more onto a file the reader left while its save was in flight', async () =>
    {
        const store = await openReady();
        let land : (node : unknown) => void = () => undefined;
        commitMock.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));

        store.setBuffer('old file edit');
        const saving = store.save();
        await vi.waitFor(() => { expect(commitMock).toHaveBeenCalledTimes(1); });

        store.reset();
        getNodeMock.mockResolvedValue(fileNode({ id: 'f2', blobID: 'c1' }));
        getTextMock.mockResolvedValue('other file');
        await store.open('f2');
        store.setBuffer('other file, edited');

        land(fileNode({ blobID: 'b2' }));
        await saving;

        expect(commitMock).toHaveBeenCalledTimes(1);
        expect(store.node?.id).toBe('f2');
        expect(store.dirty).toBe(true);
        expect(store.saving).toBe(false);
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
        commitMock.mockRejectedValueOnce(
            new ConflictAPIError('The file changed since you opened it.', 'replace.staleBlob')
        );

        store.setBuffer('my edit');
        await store.save();

        expect(store.conflict).toBe(true);
        expect(store.dirty).toBe(true);
        expect(store.buffer).toBe('my edit');
    });

    it('overwrite retries the save without the guard and clears the conflict', async () =>
    {
        const store = await openReady();
        commitMock
            .mockRejectedValueOnce(new ConflictAPIError('stale', 'replace.staleBlob'))
            .mockResolvedValueOnce(fileNode({ blobID: 'b2' }));

        store.setBuffer('my edit');
        await store.save();
        expect(store.conflict).toBe(true);

        await store.overwrite();

        // The retry drops the ifBlobID guard entirely -- last-write-wins.
        expect(commitMock.mock.calls[1]?.[1]).toEqual({ replaceNodeID: 'f1' });
        expect(store.conflict).toBe(false);
        expect(store.dirty).toBe(false);
    });

    it('reload discards local edits and restores the server content', async () =>
    {
        const store = await openReady();
        commitMock.mockRejectedValueOnce(new ConflictAPIError('stale', 'replace.staleBlob'));

        store.setBuffer('my edit');
        await store.save();
        expect(store.conflict).toBe(true);

        // The server now serves different content on reload.
        getTextMock.mockResolvedValue('their newer content');
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
});

//----------------------------------------------------------------------------------------------------------------------
