//----------------------------------------------------------------------------------------------------------------------
// File Save Session
//
// The save lifecycle a file handler's store shares. Each session is a generation that open() starts with begin() and
// reset() ends with close(); a save still in flight from an earlier generation touches no state when it resolves, so
// an autosave that outlives its file never writes a later file's content onto it.
//----------------------------------------------------------------------------------------------------------------------

import { type ComputedRef, type Ref, computed, ref } from 'vue';

import { type NodeResponse, type UploadCommitMetadata, isRoleAtLeast } from '@fileshed/core';

// Resource Access
import { ConflictAPIError } from '../resource-access/apiError.ts';
import { patchNode } from '../resource-access/nodes.ts';

// Stores
import { commitFile } from './commitFile.ts';

// Utils
import { hashFile } from '../utils/hashFile.ts';
import { describeAPIError } from '../utils/runWithToast.ts';

//----------------------------------------------------------------------------------------------------------------------

// Writes a file's bytes onto the session's node. Answers false when the generation that started the save has ended,
// and the caller then stops: nothing it saves belongs to the file now open.
export type SaveWriter = (file : File, force : boolean) => Promise<boolean>;

export interface FileSaveSession
{
    node : Ref<NodeResponse | null>;

    // The blob the content was loaded from and re-armed to on each save: the ifBlobID guard a save pins itself to.
    loadedBlobID : Ref<string | null>;

    saving : Ref<boolean>;
    saveError : Ref<string | null>;
    conflict : Ref<boolean>;
    lastSavedAt : Ref<number | null>;

    // A viewer (or no loaded node) saves nothing. Editor-or-owner saves.
    readOnly : ComputedRef<boolean>;

    // Starts a generation and answers its token, for a load to check with isCurrent after each await: a load that a
    // later open() overtook lands nothing.
    begin() : number;
    isCurrent(token : number) : boolean;
    close() : void;

    // The one save path. saving is raised synchronously, so a second trigger while a save runs returns instead of
    // starting another. A stale-blob conflict means the file moved under the guard: a conflict to resolve, not an
    // error.
    save(work : (write : SaveWriter) => Promise<void>) : Promise<void>;

    dismissConflict() : void;
    rename(name : string) : Promise<void>;
}

//----------------------------------------------------------------------------------------------------------------------

export function createFileSaveSession() : FileSaveSession
{
    const node = ref<NodeResponse | null>(null);
    const loadedBlobID = ref<string | null>(null);
    const saving = ref(false);
    const saveError = ref<string | null>(null);
    const conflict = ref(false);
    const lastSavedAt = ref<number | null>(null);

    const readOnly = computed(() => node.value === null || !isRoleAtLeast(node.value.role, 'editor'));

    let generation = 0;

    function begin() : number
    {
        generation += 1;
        saving.value = false;
        saveError.value = null;
        conflict.value = false;
        lastSavedAt.value = null;

        return generation;
    }

    function isCurrent(token : number) : boolean
    {
        return token === generation;
    }

    function close() : void
    {
        begin();
        node.value = null;
        loadedBlobID.value = null;
    }

    // Content that already hashes to the loaded blob is written nowhere. force drops the guard, the "Overwrite"
    // resolution to a conflict.
    function writerFor(started : number) : SaveWriter
    {
        return async (file, force) =>
        {
            const current = node.value;
            if(started !== generation || current === null) { return false; }

            const sha256 = await hashFile(file);
            if(started !== generation) { return false; }
            if(sha256 === loadedBlobID.value) { return true; }

            const guard = force ? null : loadedBlobID.value;
            const commit : UploadCommitMetadata = guard === null
                ? { replaceNodeID: current.id }
                : { replaceNodeID: current.id, ifBlobID: guard };

            const saved = await commitFile(file, commit, { sha256 });
            if(started !== generation) { return false; }

            node.value = saved;
            if(saved.type === 'file') { loadedBlobID.value = saved.blobID; }
            lastSavedAt.value = Date.now();
            conflict.value = false;

            return true;
        };
    }

    async function save(work : (write : SaveWriter) => Promise<void>) : Promise<void>
    {
        if(saving.value || readOnly.value) { return; }

        const started = generation;
        saving.value = true;
        saveError.value = null;

        try
        {
            await work(writerFor(started));
        }
        catch(caught)
        {
            if(started === generation)
            {
                if(caught instanceof ConflictAPIError && caught.code === 'replace.staleBlob') { conflict.value = true; }
                else { saveError.value = describeAPIError(caught); }
            }
        }
        finally
        {
            if(started === generation) { saving.value = false; }
        }
    }

    function dismissConflict() : void
    {
        conflict.value = false;
    }

    // The node is replaced with the server's response, so later saves carry the new name and the freshened timestamps
    // without a reload.
    async function rename(name : string) : Promise<void>
    {
        const current = node.value;
        const trimmed = name.trim();
        if(current === null || readOnly.value || trimmed.length === 0 || trimmed === current.name) { return; }

        node.value = await patchNode(current.id, { name: trimmed });
    }

    return {
        node,
        loadedBlobID,
        saving,
        saveError,
        conflict,
        lastSavedAt,
        readOnly,
        begin,
        isCurrent,
        close,
        save,
        dismissConflict,
        rename,
    };
}

//----------------------------------------------------------------------------------------------------------------------
