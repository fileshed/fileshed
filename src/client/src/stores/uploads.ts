//----------------------------------------------------------------------------------------------------------------------
// Uploads Store
//
// A collision pauses only its own item, and prompts are raised one at a time, so the queue never asks two questions at
// once.
//
// A dropped folder merges into an existing folder of the same name, the way an OS copy merges directories; a folder
// that can't be created shows as an error row with the folder's name rather than vanishing.
//
// A file over the instance's upload cap never enters the pipeline: the cap is known before any bytes move, so the row
// starts out failed instead of hashing only to be refused at the claim.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { type NodeResponse, type UploadCommitMetadata, isSkippedName } from '@fileshed/core';

// Stores
import { useAppStore } from './app.ts';
import { commitFile } from './commitFile.ts';
import { useDriveStore } from './drive.ts';

// Resource Access
import { readDroppedPayload } from '../resource-access/browser/droppedEntries.ts';
import { createNode, listChildren } from '../resource-access/nodes.ts';

// Engines
import type { DroppedFolder, DroppedPayload } from '../engines/uploads/droppedTree.ts';
import { type UploadStatus, isActiveStatus } from '../engines/uploads/status.ts';

// Utils
import { formatBytes } from '../utils/formatters/index.ts';
import { nextCopyName } from '../utils/nextCopyName.ts';
import { hashFile } from '../utils/hashFile.ts';
import { describeAPIError } from '../utils/runWithToast.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface UploadProgress
{
    hashedBytes : number;
    sentBytes : number;
    totalBytes : number;
}

export interface FileUploadItem
{
    kind : 'file';
    id : string;
    file : File;
    folderID : string | null;
    name : string;
    status : UploadStatus;
    progress : UploadProgress;
    result : NodeResponse | null;
    error : string | null;
}

// A folder of a dropped tree that couldn't be created. It stands in the panel so the missing subtree is visible, and
// it has nothing to retry: the folder is what failed, and none of its files were ever queued.
export interface FolderFailureItem
{
    kind : 'folder';
    id : string;
    name : string;
    status : 'error';
    error : string;
}

export type UploadItem = FileUploadItem | FolderFailureItem;

export type CollisionChoice = 'keep-both' | 'replace' | 'cancel';

export interface CollisionPrompt
{
    itemID : string;
    name : string;
}

// How many "name (n)" candidates a "keep both" will probe before giving up rather than looping forever against a folder
// that somehow rejects every name.
const MAX_RENAME_PROBES = 50;

const CONCURRENCY = 3;

// The content digest and the placement decided during preparation, carried into the claim/commit stage.
interface Prepared
{
    sha256 : string;
    commit : UploadCommitMetadata;
}

//----------------------------------------------------------------------------------------------------------------------

function isAbort(error : unknown) : boolean
{
    return error instanceof DOMException && error.name === 'AbortError';
}

function mimeOf(file : File) : string
{
    return file.type === '' ? 'application/octet-stream' : file.type;
}

//----------------------------------------------------------------------------------------------------------------------

export const useUploadsStore = defineStore('uploads', () =>
{
    const items = ref<UploadItem[]>([]);
    const prompts = ref<CollisionPrompt[]>([]);

    // Per-item machinery kept off the reactive state: an in-flight transfer's abort handle, the resolver a paused
    // prompt is waiting on, and the ids a cancel has been requested for (checked at each stage a request can't abort).
    const controllers = new Map<string, AbortController>();
    const resolvers = new Map<string, (choice : CollisionChoice) => void>();
    const cancelling = new Set<string>();

    let counter = 0;
    let active = 0;

    const currentPrompt = computed<CollisionPrompt | null>(() => prompts.value[0] ?? null);
    const activeCount = computed(() => items.value.filter((item) => isActiveStatus(item.status)).length);
    const doneCount = computed(() => items.value.filter((item) => item.status === 'done').length);
    const hasItems = computed(() => items.value.length > 0);

    //------------------------------------------------------------------------------------------------------------------
    // Collision prompts -- one at a time. askCollision parks the item on a promise the modal settles; the queue head is
    // the only prompt shown.
    //------------------------------------------------------------------------------------------------------------------

    function askCollision(itemID : string, name : string) : Promise<CollisionChoice>
    {
        return new Promise((resolve) =>
        {
            resolvers.set(itemID, resolve);
            prompts.value = [ ...prompts.value, { itemID, name } ];
        });
    }

    function settlePrompt(itemID : string, choice : CollisionChoice) : void
    {
        const resolve = resolvers.get(itemID);
        if(resolve === undefined) { return; }

        resolvers.delete(itemID);
        prompts.value = prompts.value.filter((prompt) => prompt.itemID !== itemID);
        resolve(choice);
    }

    function resolveCollision(choice : CollisionChoice) : void
    {
        const head = currentPrompt.value;
        if(head !== null) { settlePrompt(head.itemID, choice); }
    }

    //------------------------------------------------------------------------------------------------------------------

    function itemByID(itemID : string) : UploadItem | undefined
    {
        return items.value.find((item) => item.id === itemID);
    }

    function cleanup(itemID : string) : void
    {
        controllers.delete(itemID);
        resolvers.delete(itemID);
        cancelling.delete(itemID);
    }

    // A cancel that reached the item between stages: the request in flight (if any) can't be interrupted, so the
    // pipeline bails at the next checkpoint and finalizes as cancelled.
    function assertNotCancelled(item : FileUploadItem) : void
    {
        if(cancelling.has(item.id)) { throw new DOMException('Upload cancelled', 'AbortError'); }
    }

    function finalizeCancelled(item : FileUploadItem) : void
    {
        item.status = 'cancelled';
        cleanup(item.id);
    }

    function finalizeFailed(item : FileUploadItem, message : string) : void
    {
        item.status = 'error';
        item.error = message;
        cleanup(item.id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Pipeline
    //------------------------------------------------------------------------------------------------------------------

    // The commit target for a fresh node -- the item's (possibly "keep both"-renamed) name in its folder.
    function newNodeCommit(item : FileUploadItem) : UploadCommitMetadata
    {
        return { name: item.name, parentID: item.folderID, mimeType: mimeOf(item.file) };
    }

    // "Keep both": bump the name past the collision, probing each candidate against the folder until one is free.
    // Null once every probe found its name taken.
    async function resolveFreeName(item : FileUploadItem) : Promise<string | null>
    {
        let candidate = nextCopyName(item.name);

        for(let probe = 0; probe < MAX_RENAME_PROBES; probe += 1)
        {
            assertNotCancelled(item);

            // eslint-disable-next-line no-await-in-loop -- each probe depends on the previous candidate being taken
            const listing = await listChildren(item.folderID, { name: candidate, limit: 1 });
            if(listing.total === 0) { return candidate; }

            candidate = nextCopyName(candidate);
        }

        return null;
    }

    // The commit target after a collision: the user's choice decides. Returns null when the item settled without one:
    // the user cancelled, or keeping both found no free name.
    async function resolveCollisionCommit(
        item : FileUploadItem,
        target : NodeResponse
    ) : Promise<UploadCommitMetadata | null>
    {
        item.status = 'prompt';
        const choice = await askCollision(item.id, item.name);

        if(choice === 'cancel')
        {
            finalizeCancelled(item);
            return null;
        }

        // Replace overwrites the existing node's bytes; the new file's type rides along so a changed type sticks.
        if(choice === 'replace') { return { replaceNodeID: target.id, mimeType: mimeOf(item.file) }; }

        const freeName = await resolveFreeName(item);
        if(freeName === null)
        {
            finalizeFailed(item, 'Couldn\'t find an available name for this file.');
            return null;
        }

        item.name = freeName;

        return newNodeCommit(item);
    }

    // Hash, collision-check, and settle on a commit target. Returns null when the item settled along the way.
    async function prepareCommit(item : FileUploadItem) : Promise<Prepared | null>
    {
        item.status = 'hashing';
        const controller = new AbortController();
        controllers.set(item.id, controller);
        const sha256 = await hashFile(
            item.file,
            (progress) => { item.progress.hashedBytes = progress.hashedBytes; },
            controller.signal
        );

        assertNotCancelled(item);
        item.status = 'checking';
        const listing = await listChildren(item.folderID, { name: item.name, limit: 1 });
        const collision = listing.total > 0 ? listing.nodes[0] ?? null : null;

        const commit = collision !== null ? await resolveCollisionCommit(item, collision) : newNodeCommit(item);
        if(commit === null) { return null; }

        return { sha256, commit };
    }

    async function commitClaim(
        item : FileUploadItem,
        sha256 : string,
        commit : UploadCommitMetadata
    ) : Promise<NodeResponse>
    {
        item.status = 'claiming';

        return commitFile(item.file, commit, {
            sha256,
            onPhase: (phase) => { item.status = phase; },
            onProgress: (progress) =>
            {
                item.progress.sentBytes = progress.sentBytes;
                item.progress.totalBytes = progress.totalBytes;
            },
            signal: controllers.get(item.id)?.signal,
        });
    }

    async function runPipeline(item : FileUploadItem) : Promise<void>
    {
        try
        {
            const prepared = await prepareCommit(item);
            if(prepared === null) { return; }

            assertNotCancelled(item);
            const result = await commitClaim(item, prepared.sha256, prepared.commit);

            item.status = 'done';
            item.result = result;
            cleanup(item.id);

            const drive = useDriveStore();
            if(item.folderID === drive.folderID) { await drive.refresh().catch(() => undefined); }
        }
        catch(caught)
        {
            if(isAbort(caught)) { finalizeCancelled(item); return; }

            finalizeFailed(item, describeAPIError(caught));
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Queue pump -- start queued items up to the concurrency cap. runPipeline moves the item off `queued` synchronously
    // before its first await, so the same item is never started twice.
    //------------------------------------------------------------------------------------------------------------------

    function pump() : void
    {
        while(active < CONCURRENCY)
        {
            const next = items.value.find((item) : item is FileUploadItem =>
            {
                return item.kind === 'file' && item.status === 'queued';
            });
            if(next === undefined) { break; }

            active += 1;
            void runPipeline(next).finally(() =>
            {
                active -= 1;
                pump();
            });
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Actions
    //------------------------------------------------------------------------------------------------------------------

    // How many files this batch refused to send because the instance does not store names like theirs.
    const skipped = ref(0);

    // A batch started while nothing is running opens a clean window: the previous batch's rows -- done, errored,
    // or cancelled -- are history, not part of the new work, and neither is what it skipped. Rows join an existing
    // window only while it still has active items. A window holding nothing but a skipped count is idle too,
    // otherwise a second batch of pure junk reports the sum of both.
    function startFreshBatchIfIdle() : void
    {
        if(items.value.every((item) => !isActiveStatus(item.status)))
        {
            items.value = [];
            skipped.value = 0;
        }
    }

    // Why this file can't be uploaded at all, or null when it can. Read live, so an admin who raises the cap makes a
    // rejected row retryable rather than permanently dead.
    function overCapError(file : File) : string | null
    {
        const maxBytes = useAppStore().uploadMaxBytes;
        if(file.size <= maxBytes) { return null; }

        return `${ file.name } is ${ formatBytes(file.size) } — larger than the `
            + `${ formatBytes(maxBytes) } upload limit.`;
    }

    // The shared row-appender behind the public entry points; deliberately no fresh-batch reset, so the multiple
    // adds inside one payload (loose files, then each folder) never wipe rows the same payload just created.
    function addFiles(files : readonly File[], folderID : string | null) : void
    {
        const skipPatterns = useAppStore().skippedUploadNames;

        // Skipped before anything is hashed or sent. These are not errors and they get no row: a folder upload from a
        // Mac carries one .DS_Store per directory, and a panel listing each of them as a failure would bury the files
        // the user actually chose. The count is what the panel says instead.
        const wanted = files.filter((file) => !isSkippedName(file.name, skipPatterns));
        skipped.value += files.length - wanted.length;

        for(const file of wanted)
        {
            counter += 1;

            const error = overCapError(file);

            items.value.push({
                kind: 'file',
                id: `upload-${ counter }`,
                file,
                folderID,
                name: file.name,
                status: error === null ? 'queued' : 'error',
                progress: { hashedBytes: 0, sentBytes: 0, totalBytes: file.size },
                result: null,
                error,
            });
        }

        pump();
    }

    function enqueue(files : readonly File[], folderID : string | null) : void
    {
        startFreshBatchIfIdle();
        addFiles(files, folderID);
    }

    // A folder that couldn't be created still needs a face in the panel -- an error row wearing the folder's name,
    // so a failed subtree is visible instead of silently missing.
    function pushFolderError(name : string, error : unknown) : void
    {
        counter += 1;
        items.value.push({
            kind: 'folder',
            id: `upload-${ counter }`,
            name,
            status: 'error',
            error: `Couldn't create this folder — nothing inside it was uploaded. ${ describeAPIError(error) }`,
        });
    }

    // The folder a dropped tree lands in: merged into an existing same-named sibling folder when there is one --
    // the way an OS copy merges directories, and because the server happily mints duplicate names -- and created
    // fresh otherwise. The lookup comes first precisely because creation would succeed and silently fork the tree.
    async function ensureFolder(name : string, parentID : string | null) : Promise<string>
    {
        const listing = await listChildren(parentID, { name, types: [ 'folders' ], limit: 1 });
        const existing = listing.nodes[0];

        if(existing !== undefined && existing.type === 'folder') { return existing.id; }

        const created = await createNode({ type: 'folder', name, parentID });

        return created.id;
    }

    async function enqueueFolders(folders : readonly DroppedFolder[], parentID : string | null) : Promise<void>
    {
        for(const folder of folders)
        {
            let folderNodeID : string | null = null;

            try
            {
                // eslint-disable-next-line no-await-in-loop -- sibling folders create serially, in drop order
                folderNodeID = await ensureFolder(folder.name, parentID);
            }
            catch(caught)
            {
                pushFolderError(folder.name, caught);
            }

            if(folderNodeID !== null)
            {
                addFiles(folder.files, folderNodeID);

                // eslint-disable-next-line no-await-in-loop -- the subtree needs its parent's id before it can start
                await enqueueFolders(folder.folders, folderNodeID);
            }
        }
    }

    // A folder upload, from either doorway: the picker input's relative paths or a drop's traversed entries. Loose
    // files start immediately; each folder is created (or merged) first so its contents land inside it.
    async function enqueuePayload(payload : DroppedPayload, folderID : string | null) : Promise<void>
    {
        startFreshBatchIfIdle();
        addFiles(payload.files, folderID);
        await enqueueFolders(payload.folders, folderID);

        const drive = useDriveStore();
        if(payload.folders.length > 0 && folderID === drive.folderID)
        {
            await drive.refresh().catch(() => undefined);
        }
    }

    // The drop-zone path: entry handles were collected synchronously during the drop; files is the fallback for a
    // browser (or a drag source) that offers no entries.
    async function enqueueDropped(
        entries : readonly FileSystemEntry[],
        files : readonly File[],
        folderID : string | null
    ) : Promise<void>
    {
        if(entries.length === 0)
        {
            enqueue(files, folderID);
            return;
        }

        await enqueuePayload(await readDroppedPayload(entries), folderID);
    }

    function cancel(itemID : string) : void
    {
        const item = itemByID(itemID);
        if(item === undefined || !isActiveStatus(item.status)) { return; }

        cancelling.add(itemID);
        settlePrompt(itemID, 'cancel');
        controllers.get(itemID)?.abort();

        // A still-queued item never entered the pipeline, so nothing will finalize it -- do it here.
        if(item.status === 'queued') { finalizeCancelled(item); }
    }

    function retry(itemID : string) : void
    {
        const item = itemByID(itemID);
        if(item?.kind !== 'file' || item.status !== 'error') { return; }

        cleanup(itemID);
        item.error = overCapError(item.file);
        item.progress = { hashedBytes: 0, sentBytes: 0, totalBytes: item.file.size };
        item.status = item.error === null ? 'queued' : 'error';

        pump();
    }

    // Drop every finished item -- the panel's clear/dismiss. In-flight items stay.
    function clearFinished() : void
    {
        items.value = items.value.filter((item) => isActiveStatus(item.status));
        skipped.value = 0;
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        skipped,
        items,
        currentPrompt,
        activeCount,
        doneCount,
        hasItems,
        enqueue,
        enqueuePayload,
        enqueueDropped,
        cancel,
        retry,
        resolveCollision,
        clearFinished,
    };
});

//----------------------------------------------------------------------------------------------------------------------
