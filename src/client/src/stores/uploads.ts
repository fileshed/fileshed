//----------------------------------------------------------------------------------------------------------------------
// Uploads Store
//
// The upload queue and the pipeline behind it. Each dropped or picked file becomes an item that walks a fixed path:
// hash the bytes, check the target folder for a name collision, pause for the user's choice if one is found, claim the
// blob, then either PUT the bytes against the ticket or answer a proof-of-possession challenge -- both of which commit
// the file node. At most three items run at once; the rest wait their turn. A collision pauses just its own item and
// raises one prompt at a time, so the queue never asks two questions at once. An item landing in the folder the drive
// view currently shows refreshes that listing. Cancellation aborts an in-flight transfer, settles a waiting prompt, or
// drops a still-queued item; every failure leaves a readable message on the item's own row.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type { NodeResponse, UploadCommitMetadata } from '@fileshed/core';

// Stores
import { useDriveStore } from './drive.ts';

// Resource Access
import { answerChallenge, claimBlob } from '../resource-access/blobs.ts';
import { getChildren } from '../resource-access/nodes.ts';
import { uploadWithProgress } from '../resource-access/uploadWithProgress.ts';

// Engines
import { computeProofAnswer } from '../engines/claim.ts';

// Utils
import { nextCopyName } from '../utils/formatters/index.ts';
import { hashFile, readSampleWindows } from '../utils/hashFile.ts';
import { describeApiError } from '../utils/runWithToast.ts';

//----------------------------------------------------------------------------------------------------------------------

export type UploadStatus
    = 'queued' | 'hashing' | 'checking' | 'prompt' | 'claiming'
    | 'uploading' | 'proving' | 'done' | 'error' | 'cancelled';

export interface UploadProgress
{
    hashedBytes : number;
    sentBytes : number;
    totalBytes : number;
}

export interface UploadItem
{
    id : string;
    file : File;
    folderID : string | null;
    name : string;
    status : UploadStatus;
    progress : UploadProgress;
    result : NodeResponse | null;
    error : string | null;
}

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

const TERMINAL : ReadonlySet<UploadStatus> = new Set([ 'done', 'error', 'cancelled' ]);

// An item still moving through the pipeline: not yet in a terminal state. Such an item is cancellable and shows a
// progress bar; the row reads this rather than re-listing the status set.
export function isActiveStatus(status : UploadStatus) : boolean
{
    return !TERMINAL.has(status);
}

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
    const activeCount = computed(() => items.value.filter((item) => !TERMINAL.has(item.status)).length);
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
    function ensureLive(item : UploadItem) : void
    {
        if(cancelling.has(item.id)) { throw new DOMException('Upload cancelled', 'AbortError'); }
    }

    function finalizeCancelled(item : UploadItem) : void
    {
        item.status = 'cancelled';
        cleanup(item.id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Pipeline
    //------------------------------------------------------------------------------------------------------------------

    // The commit target for a fresh node -- the item's (possibly "keep both"-renamed) name in its folder.
    function createCommit(item : UploadItem) : UploadCommitMetadata
    {
        return { name: item.name, parentID: item.folderID, mimeType: mimeOf(item.file) };
    }

    // "Keep both": bump the name past the collision, probing each candidate against the folder until one is free.
    async function resolveFreeName(item : UploadItem) : Promise<string>
    {
        let candidate = nextCopyName(item.name);

        for(let probe = 0; probe < MAX_RENAME_PROBES; probe += 1)
        {
            ensureLive(item);

            // eslint-disable-next-line no-await-in-loop -- each probe depends on the previous candidate being taken
            const listing = await getChildren(item.folderID, { name: candidate, limit: 1 });
            if(listing.total === 0) { return candidate; }

            candidate = nextCopyName(candidate);
        }

        throw new Error('Couldn\'t find an available name for this file.');
    }

    // The commit target after a collision: the user's choice decides. Returns null when they cancelled.
    async function resolveCollisionCommit(
        item : UploadItem,
        target : NodeResponse
    ) : Promise<UploadCommitMetadata | null>
    {
        item.status = 'prompt';
        const choice = await askCollision(item.id, item.name);

        if(choice === 'cancel') { return null; }

        // Replace overwrites the existing node's bytes; the new file's type rides along so a changed type sticks.
        if(choice === 'replace') { return { replaceNodeID: target.id, mimeType: mimeOf(item.file) }; }

        item.name = await resolveFreeName(item);

        return createCommit(item);
    }

    // Hash, collision-check, and settle on a commit target. Returns null when the item was cancelled along the way.
    async function prepareCommit(item : UploadItem) : Promise<Prepared | null>
    {
        item.status = 'hashing';
        const controller = new AbortController();
        controllers.set(item.id, controller);
        const sha256 = await hashFile(
            item.file,
            (progress) => { item.progress.hashedBytes = progress.hashedBytes; },
            controller.signal
        );

        ensureLive(item);
        item.status = 'checking';
        const listing = await getChildren(item.folderID, { name: item.name, limit: 1 });
        const collision = listing.total > 0 ? listing.nodes[0] ?? null : null;

        const commit = collision !== null ? await resolveCollisionCommit(item, collision) : createCommit(item);
        if(commit === null) { return null; }

        return { sha256, commit };
    }

    async function commitClaim(
        item : UploadItem,
        sha256 : string,
        commit : UploadCommitMetadata
    ) : Promise<NodeResponse>
    {
        item.status = 'claiming';
        const claim = await claimBlob({ sha256, size: item.file.size });

        if(claim.upload)
        {
            item.status = 'uploading';

            return uploadWithProgress({
                ticket: claim.ticket,
                body: item.file,
                commit,
                onProgress: (progress) =>
                {
                    item.progress.sentBytes = progress.sentBytes;
                    item.progress.totalBytes = progress.totalBytes;
                },
                signal: controllers.get(item.id)?.signal,
            });
        }

        item.status = 'proving';
        const windows = await readSampleWindows(item.file, claim.ranges);
        const answer = await computeProofAnswer(claim.nonce, windows);

        return answerChallenge(claim.challengeID, { answer, ...commit });
    }

    async function runPipeline(item : UploadItem) : Promise<void>
    {
        try
        {
            const prepared = await prepareCommit(item);
            if(prepared === null) { finalizeCancelled(item); return; }

            ensureLive(item);
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

            item.status = 'error';
            item.error = describeApiError(caught);
            cleanup(item.id);
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
            const next = items.value.find((item) => item.status === 'queued');
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

    function enqueue(files : readonly File[], folderID : string | null) : void
    {
        for(const file of files)
        {
            counter += 1;
            items.value.push({
                id: `upload-${ counter }`,
                file,
                folderID,
                name: file.name,
                status: 'queued',
                progress: { hashedBytes: 0, sentBytes: 0, totalBytes: file.size },
                result: null,
                error: null,
            });
        }

        pump();
    }

    function cancel(itemID : string) : void
    {
        const item = itemByID(itemID);
        if(item === undefined || TERMINAL.has(item.status)) { return; }

        cancelling.add(itemID);
        settlePrompt(itemID, 'cancel');
        controllers.get(itemID)?.abort();

        // A still-queued item never entered the pipeline, so nothing will finalize it -- do it here.
        if(item.status === 'queued') { finalizeCancelled(item); }
    }

    function retry(itemID : string) : void
    {
        const item = itemByID(itemID);
        if(item === undefined || item.status !== 'error') { return; }

        cleanup(itemID);
        item.error = null;
        item.progress = { hashedBytes: 0, sentBytes: 0, totalBytes: item.file.size };
        item.status = 'queued';

        pump();
    }

    // Drop every finished item -- the panel's clear/dismiss. In-flight items stay.
    function clearFinished() : void
    {
        items.value = items.value.filter((item) => !TERMINAL.has(item.status));
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        items,
        currentPrompt,
        activeCount,
        doneCount,
        hasItems,
        enqueue,
        cancel,
        retry,
        resolveCollision,
        clearFinished,
    };
});

//----------------------------------------------------------------------------------------------------------------------
