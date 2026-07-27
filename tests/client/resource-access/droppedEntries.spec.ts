//----------------------------------------------------------------------------------------------------------------------
// Dropped Entries Resource Access — traversing drag-and-drop FileSystemEntry handles
//
// The contract: dropped files hydrate into Files; dropped directories walk their whole contents, however many
// readEntries batches the browser serves them in (completion is the empty batch), into the dropped-tree shape.
// Exercised over hand-built entry fakes, since jsdom carries no filesystem API.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Under test
import { readDroppedPayload } from '@client/resource-access/droppedEntries.ts';

//----------------------------------------------------------------------------------------------------------------------

function fileEntry(name : string) : FileSystemEntry
{
    return {
        isFile: true,
        isDirectory: false,
        name,
        file: (resolve : (file : File) => void) => { resolve(new File([], name)); },
    } as unknown as FileSystemEntry;
}

function directoryEntry(name : string, children : FileSystemEntry[], batchSize = children.length) : FileSystemEntry
{
    let served = 0;

    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
            readEntries: (resolve : (batch : FileSystemEntry[]) => void) =>
            {
                const batch = children.slice(served, served + batchSize);
                served += batch.length;
                resolve(batch);
            },
        }),
    } as unknown as FileSystemEntry;
}

//----------------------------------------------------------------------------------------------------------------------

describe('readDroppedPayload', () =>
{
    it('hydrates a mixed drop into loose files and fully-walked folder trees', async () =>
    {
        const payload = await readDroppedPayload([
            fileEntry('loose.txt'),
            directoryEntry('Music', [
                fileEntry('one.mp3'),
                directoryEntry('Albums', [ fileEntry('two.mp3') ]),
            ]),
        ]);

        expect(payload.files.map((file) => file.name)).toEqual([ 'loose.txt' ]);

        const music = payload.folders[0];
        expect(music?.name).toBe('Music');
        expect(music?.files.map((file) => file.name)).toEqual([ 'one.mp3' ]);
        expect(music?.folders[0]?.name).toBe('Albums');
        expect(music?.folders[0]?.files.map((file) => file.name)).toEqual([ 'two.mp3' ]);
    });

    it('keeps reading a directory until the empty batch, so large folders arrive whole', async () =>
    {
        const children = Array.from({ length: 5 }, (unused, index) => fileEntry(`track-${ index }.mp3`));

        const payload = await readDroppedPayload([ directoryEntry('Music', children, 2) ]);

        expect(payload.folders[0]?.files).toHaveLength(5);
    });
});

//----------------------------------------------------------------------------------------------------------------------
