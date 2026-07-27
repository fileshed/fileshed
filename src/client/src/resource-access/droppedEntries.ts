//----------------------------------------------------------------------------------------------------------------------
// Dropped Entries Resource Access
//
// Turns the FileSystemEntry handles a drag-and-drop carries into the dropped-tree shape the uploads store walks.
// The handles themselves must be collected synchronously inside the drop event (the drop zone does that); reading
// them -- directory listings arrive in batches, files hydrate through callbacks -- is the I/O that lives here. The
// walk is depth-capped as a backstop against pathological nesting, not as a product limit.
//----------------------------------------------------------------------------------------------------------------------

import { MAX_TREE_DEPTH } from '@fileshed/core';

// Engines
import type { DroppedFolder, DroppedPayload } from '../engines/uploads/droppedTree.ts';

//----------------------------------------------------------------------------------------------------------------------

function fileOf(entry : FileSystemFileEntry) : Promise<File>
{
    return new Promise((resolve, reject) => { entry.file(resolve, reject); });
}

// readEntries hands out at most a batch (Chrome caps it at 100) per call and signals completion with an empty one.
async function allEntries(directory : FileSystemDirectoryEntry) : Promise<FileSystemEntry[]>
{
    const reader = directory.createReader();
    const collected : FileSystemEntry[] = [];

    for(;;)
    {
        // eslint-disable-next-line no-await-in-loop -- the reader is a stateful cursor; batches are inherently serial
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        {
            reader.readEntries(resolve, reject);
        });

        if(batch.length === 0) { return collected; }

        collected.push(...batch);
    }
}

async function readFolder(directory : FileSystemDirectoryEntry, depth : number) : Promise<DroppedFolder>
{
    const folder : DroppedFolder = { name: directory.name, files: [], folders: [] };
    if(depth > MAX_TREE_DEPTH) { return folder; }

    for(const entry of await allEntries(directory))
    {
        if(entry.isFile)
        {
            // eslint-disable-next-line no-await-in-loop -- entries hydrate serially to keep file order stable
            folder.files.push(await fileOf(entry as FileSystemFileEntry));
        }
        else if(entry.isDirectory)
        {
            // eslint-disable-next-line no-await-in-loop -- entries hydrate serially to keep file order stable
            folder.folders.push(await readFolder(entry as FileSystemDirectoryEntry, depth + 1));
        }
    }

    return folder;
}

//----------------------------------------------------------------------------------------------------------------------

export async function readDroppedPayload(entries : readonly FileSystemEntry[]) : Promise<DroppedPayload>
{
    const payload : DroppedPayload = { files: [], folders: [] };

    for(const entry of entries)
    {
        if(entry.isFile)
        {
            // eslint-disable-next-line no-await-in-loop -- entries hydrate serially to keep drop order stable
            payload.files.push(await fileOf(entry as FileSystemFileEntry));
        }
        else if(entry.isDirectory)
        {
            // eslint-disable-next-line no-await-in-loop -- entries hydrate serially to keep drop order stable
            payload.folders.push(await readFolder(entry as FileSystemDirectoryEntry, 0));
        }
    }

    return payload;
}

//----------------------------------------------------------------------------------------------------------------------
