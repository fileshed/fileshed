//----------------------------------------------------------------------------------------------------------------------
// Dropped Tree Engine — rebuilding the folder tree a directory pick describes
//
// The contract: each file's webkitRelativePath spells out the folders above it; files sharing a path share the same
// folder node (no duplicates); a file with no relative path is loose at the root.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { payloadFromRelativePaths } from '@client/engines/uploads/droppedTree.ts';

//----------------------------------------------------------------------------------------------------------------------

function pathedFile(name : string, relativePath : string) : File
{
    const file = new File([], name);
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });

    return file;
}

//----------------------------------------------------------------------------------------------------------------------

describe('payloadFromRelativePaths', () =>
{
    it('rebuilds the nested tree, seating each file at its deepest folder', () =>
    {
        const payload = payloadFromRelativePaths([
            pathedFile('one.mp3', 'Music/one.mp3'),
            pathedFile('two.mp3', 'Music/Albums/two.mp3'),
            pathedFile('three.mp3', 'Music/Albums/three.mp3'),
        ]);

        expect(payload.files).toEqual([]);
        expect(payload.folders).toHaveLength(1);

        const music = payload.folders[0];
        expect(music?.name).toBe('Music');
        expect(music?.files.map((file) => file.name)).toEqual([ 'one.mp3' ]);
        expect(music?.folders).toHaveLength(1);

        const albums = music?.folders[0];
        expect(albums?.name).toBe('Albums');
        expect(albums?.files.map((file) => file.name)).toEqual([ 'two.mp3', 'three.mp3' ]);
    });

    it('leaves a file with no relative path loose at the root', () =>
    {
        const payload = payloadFromRelativePaths([
            new File([], 'loose.txt'),
            pathedFile('one.mp3', 'Music/one.mp3'),
        ]);

        expect(payload.files.map((file) => file.name)).toEqual([ 'loose.txt' ]);
        expect(payload.folders[0]?.name).toBe('Music');
    });
});

//----------------------------------------------------------------------------------------------------------------------
