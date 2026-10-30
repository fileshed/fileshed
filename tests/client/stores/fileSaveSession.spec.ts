// @vitest-environment node

//----------------------------------------------------------------------------------------------------------------------
// File Save Session
//
// commitFile and the node calls are mocked; hashing runs for real. Runs in the node environment because
// jsdom's File has no .stream(), which hashing reads through.
//----------------------------------------------------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// Resource Access
import { ApiError, ConflictApiError } from '@client/resource-access/apiError.ts';
import { patchNode } from '@client/resource-access/nodes.ts';

// Stores
import { commitFile } from '@client/stores/commitFile.ts';
import { type FileSaveSession, type SaveWriter, createFileSaveSession } from '@client/stores/fileSaveSession.ts';

// Support
import { fileNode } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/stores/commitFile.ts', () => ({ commitFile: vi.fn() }));
vi.mock('@client/resource-access/nodes.ts', () => ({ patchNode: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

const commitMock = commitFile as unknown as Mock;
const patchNodeMock = patchNode as unknown as Mock;

function digestOf(text : string) : string
{
    return createHash('sha256')
        .update(text)
        .digest('hex');
}

function textFile(text : string) : File
{
    return new File([ text ], 'notes.txt');
}

// A session with node n1 open, loaded from blob b0.
function openSession() : FileSaveSession
{
    const session = createFileSaveSession();
    session.begin();
    session.node.value = fileNode({ id: 'n1', name: 'notes.txt', blobID: 'b0' });
    session.loadedBlobID.value = 'b0';

    return session;
}

// Saves `text` through the session and hands back what the writer answered.
async function saveText(session : FileSaveSession, text : string, force = false) : Promise<boolean | undefined>
{
    let landed : boolean | undefined;
    await session.save(async (write) => { landed = await write(textFile(text), force); });

    return landed;
}

beforeEach(() =>
{
    vi.resetAllMocks();
});

//----------------------------------------------------------------------------------------------------------------------

describe('createFileSaveSession', () =>
{
    it('writes nothing for content that already hashes to the loaded blob', async () =>
    {
        const session = openSession();
        session.loadedBlobID.value = digestOf('unchanged');

        expect(await saveText(session, 'unchanged')).toBe(true);
        expect(commitMock).not.toHaveBeenCalled();
        expect(session.saving.value).toBe(false);
    });

    it('pins a write to the loaded blob and re-arms to the blob it landed', async () =>
    {
        const session = openSession();
        const saved = fileNode({ id: 'n1', name: 'notes.txt', blobID: 'b1' });
        commitMock.mockResolvedValue(saved);

        expect(await saveText(session, 'edited')).toBe(true);

        expect(commitMock).toHaveBeenCalledWith(expect.any(File), { replaceNodeID: 'n1', ifBlobID: 'b0' }, {
            sha256: digestOf('edited'),
        });
        expect(session.node.value).toEqual(saved);
        expect(session.loadedBlobID.value).toBe('b1');
        expect(session.lastSavedAt.value).not.toBeNull();
    });

    it('drops the guard when the save is forced', async () =>
    {
        const session = openSession();
        commitMock.mockResolvedValue(fileNode({ id: 'n1', blobID: 'b1' }));

        await saveText(session, 'mine wins', true);

        expect(commitMock).toHaveBeenCalledWith(expect.any(File), { replaceNodeID: 'n1' }, expect.anything());
    });

    it('reads a 409 as a conflict to resolve rather than an error', async () =>
    {
        const session = openSession();
        commitMock.mockRejectedValue(
            new ConflictApiError('The file changed since you opened it.', 'replace.staleBlob')
        );

        await saveText(session, 'edited');

        expect(session.conflict.value).toBe(true);
        expect(session.saveError.value).toBeNull();
        expect(session.saving.value).toBe(false);
    });

    // The chunked transfer settles the conflicts it can by asking again; one it hands back means these bytes did not
    // land, which is a failed save rather than someone else's newer version.
    it('reports a conflict other than a stale blob as a save error', async () =>
    {
        const session = openSession();
        commitMock.mockRejectedValue(new ConflictApiError('These bytes do not belong here.', 'upload.offsetConflict'));

        await saveText(session, 'edited');

        expect(session.conflict.value).toBe(false);
        expect(session.saveError.value).toBe('These bytes do not belong here.');
    });

    it('reports any other failure as a save error', async () =>
    {
        const session = openSession();
        commitMock.mockRejectedValue(new ApiError(500, 'Storage is unavailable.'));

        await saveText(session, 'edited');

        expect(session.saveError.value).toBe('Storage is unavailable.');
        expect(session.conflict.value).toBe(false);
    });

    it('ignores a second save while one is in flight', async () =>
    {
        const session = openSession();
        let land : (node : unknown) => void = () => undefined;
        commitMock.mockImplementation(() => new Promise((resolve) => { land = resolve; }));

        const first = saveText(session, 'first');
        const second = vi.fn();
        await session.save(second);

        expect(second).not.toHaveBeenCalled();

        await vi.waitFor(() => { expect(commitMock).toHaveBeenCalled(); });
        land(fileNode({ id: 'n1', blobID: 'b1' }));
        await first;
    });

    // An autosave can still be on the wire when the reader leaves the file or opens another. Whatever it lands, the
    // session open now must not take its node, its guard or its saving flag from it.
    it('leaves the next session alone when a save from an earlier one resolves', async () =>
    {
        const session = openSession();
        let land : (node : unknown) => void = () => undefined;
        commitMock.mockImplementation(() => new Promise((resolve) => { land = resolve; }));

        let writer : SaveWriter | undefined;
        const saving = session.save(async (write) =>
        {
            writer = write;
            await write(textFile('old file text'), false);
        });
        await vi.waitFor(() => { expect(commitMock).toHaveBeenCalled(); });

        session.begin();
        const next = fileNode({ id: 'n2', name: 'other.txt', blobID: 'c0' });
        session.node.value = next;
        session.loadedBlobID.value = 'c0';

        land(fileNode({ id: 'n1', blobID: 'b1' }));
        await saving;

        expect(session.node.value).toEqual(next);
        expect(session.loadedBlobID.value).toBe('c0');
        expect(session.lastSavedAt.value).toBeNull();
        expect(await writer?.(textFile('next file text'), false)).toBe(false);
    });

    it('renames the open file in place', async () =>
    {
        const session = openSession();
        const renamed = fileNode({ id: 'n1', name: 'renamed.txt', blobID: 'b0' });
        patchNodeMock.mockResolvedValue(renamed);

        await session.rename('  renamed.txt ');

        expect(patchNodeMock).toHaveBeenCalledWith('n1', { name: 'renamed.txt' });
        expect(session.node.value).toEqual(renamed);
    });

    it('renames nothing for a viewer, a blank name or the current name', async () =>
    {
        const session = openSession();

        await session.rename('notes.txt');
        await session.rename('   ');
        session.node.value = fileNode({ id: 'n1', name: 'notes.txt', role: 'viewer' });
        await session.rename('renamed.txt');

        expect(patchNodeMock).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
