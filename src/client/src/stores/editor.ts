//----------------------------------------------------------------------------------------------------------------------
// Editor Store
//
// The open-file editing session: load a file's text, track the dirty buffer, and save it back through the same
// claim / proof-of-possession / replace flow an upload uses -- so a save dedups against known content and preserves the
// node's id, links, and shares. Two save triggers share one pipeline: an explicit save (button or Cmd/Ctrl+S) and a 2s
// debounced autosave after the last edit. They are serialized -- never two saves in flight, and an explicit save
// cancels a pending autosave. Each save re-arms the optimistic-concurrency guard with the blob it just wrote, so a
// stale save (someone else saved first) is refused with a conflict the user resolves by reloading or overwriting.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { type NodeResponse, type UploadCommitMetadata, isRoleAtLeast } from '@fileshed/core';

// Resource Access
import { ApiError } from '../resource-access/apiError.ts';
import { answerChallenge, claimBlob, uploadTicket } from '../resource-access/blobs.ts';
import { fetchNodeText } from '../resource-access/content.ts';
import { getNode } from '../resource-access/nodes.ts';

// Engines
import { computeProofAnswer } from '../engines/claim.ts';
import { EDITOR_MAX_BYTES, type EditorMode, intent } from '../engines/intent/index.ts';

// Utils
import { hashFile, readSampleWindows } from '../utils/hashFile.ts';
import { describeApiError } from '../utils/runWithToast.ts';

//----------------------------------------------------------------------------------------------------------------------

// The quiet period after the last edit before an autosave fires. Long enough that a burst of typing debounces to one
// save, short enough that a pause is captured before the user tabs away.
const AUTOSAVE_DEBOUNCE_MS = 2000;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

//----------------------------------------------------------------------------------------------------------------------

export const useEditorStore = defineStore('editor', () =>
{
    const node = ref<NodeResponse | null>(null);
    const buffer = ref('');
    const savedText = ref('');

    // The blob the buffer was loaded from and re-armed to on each save: the ifBlobID guard a save pins itself to.
    const loadedBlobID = ref<string | null>(null);

    const mode = ref<EditorMode>('plain');
    const autosaveEnabled = ref(true);

    const loadState = ref<LoadState>('idle');
    const loadError = ref<string | null>(null);

    const saving = ref(false);
    const saveError = ref<string | null>(null);
    const conflict = ref(false);
    const lastSavedAt = ref<number | null>(null);

    // The pending autosave timer, kept out of reactive state -- it is machinery, not view data.
    let autosaveTimer : ReturnType<typeof setTimeout> | null = null;

    //------------------------------------------------------------------------------------------------------------------

    const dirty = computed(() => buffer.value !== savedText.value);

    // A viewer (or no loaded node) edits nothing: the editor renders read-only and never saves. Editor-or-owner saves.
    const readOnly = computed(() => node.value === null || !isRoleAtLeast(node.value.role, 'editor'));

    function clearAutosave() : void
    {
        if(autosaveTimer !== null)
        {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Save
    //------------------------------------------------------------------------------------------------------------------

    // Hash the buffer as UTF-8 through the same streaming hash the upload flow keys claims on, and keep the File so the
    // proof-of-possession path can read sample windows over the exact same bytes.
    async function hashBuffer(text : string, name : string) : Promise<{ sha : string; file : File }>
    {
        const file = new File([ text ], name);
        return { sha: await hashFile(file), file };
    }

    // Save the bytes onto the existing node via claim -> ticket-PUT or challenge-answer, with the concurrency guard
    // (omitted on an overwrite). Content-addressing means an identical or already-known body dedups server-side.
    async function commitReplace(nodeID : string, file : File, sha : string, ifBlobID : string | undefined)
    : Promise<NodeResponse>
    {
        const commit : UploadCommitMetadata = ifBlobID === undefined
            ? { replaceNodeID: nodeID }
            : { replaceNodeID: nodeID, ifBlobID };

        const claim = await claimBlob({ sha256: sha, size: file.size });
        if(claim.upload)
        {
            return uploadTicket(claim.ticket, file, commit);
        }

        const windows = await readSampleWindows(file, claim.ranges);
        const answer = await computeProofAnswer(claim.nonce, windows);
        return answerChallenge(claim.challengeID, { answer, ...commit });
    }

    // One save pass over the current buffer. A body that already hashes to the node's blob is the cheapest no-op --
    // nothing is written. Otherwise the write re-arms the guard to the blob it just landed and clears any conflict.
    async function performSave(force : boolean) : Promise<void>
    {
        const current = node.value;
        if(current === null) { return; }

        const text = buffer.value;
        const { sha, file } = await hashBuffer(text, current.name);

        if(sha === loadedBlobID.value)
        {
            savedText.value = text;
            return;
        }

        const guard = force ? undefined : (loadedBlobID.value ?? undefined);
        const saved = await commitReplace(current.id, file, sha, guard);

        node.value = saved;
        if(saved.type === 'file') { loadedBlobID.value = saved.blobID; }
        savedText.value = text;
        lastSavedAt.value = Date.now();
        conflict.value = false;
    }

    // Save, then converge: edits that landed while the save was in flight leave the buffer dirty, so keep saving until
    // it settles (only while autosave is on, and never past a conflict). A follow-up pass never inherits an overwrite's
    // dropped guard -- once the first write lands, later passes guard against what it wrote.
    async function saveLoop(force : boolean) : Promise<void>
    {
        await performSave(force);

        if(dirty.value && autosaveEnabled.value && !conflict.value && !readOnly.value)
        {
            return saveLoop(false);
        }
    }

    // The one save path both triggers funnel through. saving is raised synchronously so a second trigger (an autosave
    // firing while an explicit save runs) returns rather than starting a second in-flight save. force drops the guard,
    // the "Overwrite" resolution to a conflict.
    async function runSave(force : boolean) : Promise<void>
    {
        clearAutosave();

        if(saving.value || node.value === null || readOnly.value) { return; }

        saving.value = true;
        saveError.value = null;

        try
        {
            await saveLoop(force);
        }
        catch(caught)
        {
            if(caught instanceof ApiError && caught.status === 409) { conflict.value = true; }
            else { saveError.value = describeApiError(caught); }
        }
        finally
        {
            saving.value = false;
        }
    }

    async function save() : Promise<void>
    {
        return runSave(false);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Autosave debounce
    //------------------------------------------------------------------------------------------------------------------

    function scheduleAutosave() : void
    {
        clearAutosave();
        autosaveTimer = setTimeout(() => { void runSave(false); }, AUTOSAVE_DEBOUNCE_MS);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Edit
    //------------------------------------------------------------------------------------------------------------------

    function setBuffer(text : string) : void
    {
        buffer.value = text;
        if(!autosaveEnabled.value || readOnly.value) { return; }

        if(dirty.value) { scheduleAutosave(); }
        else { clearAutosave(); }
    }

    function setMode(next : EditorMode) : void
    {
        mode.value = next;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Load
    //------------------------------------------------------------------------------------------------------------------

    async function open(nodeID : string) : Promise<void>
    {
        clearAutosave();
        loadState.value = 'loading';
        loadError.value = null;
        saveError.value = null;
        conflict.value = false;
        lastSavedAt.value = null;

        try
        {
            const loaded = await getNode(nodeID);
            node.value = loaded;

            if(loaded.type !== 'file')
            {
                loadState.value = 'error';
                loadError.value = 'This item can\'t be opened in the editor.';
                return;
            }
            if(loaded.size > EDITOR_MAX_BYTES)
            {
                loadState.value = 'error';
                loadError.value = 'This file is too large to edit here. Download it to view the whole thing.';
                return;
            }

            const text = await fetchNodeText(nodeID);
            buffer.value = text;
            savedText.value = text;
            loadedBlobID.value = loaded.blobID;
            mode.value = intent.handlers.defaultEditorMode(loaded.mimeType, loaded.name);
            loadState.value = 'ready';
        }
        catch(caught)
        {
            node.value = null;
            loadState.value = 'error';
            loadError.value = describeApiError(caught);
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Conflict resolution
    //------------------------------------------------------------------------------------------------------------------

    // Discard local edits and reload the server's current content -- the "Reload" resolution to a conflict.
    async function reload() : Promise<void>
    {
        const current = node.value;
        if(current === null) { return; }

        conflict.value = false;
        await open(current.id);
    }

    // Retry the save without the guard, clobbering whatever landed first -- the "Overwrite" resolution.
    async function overwrite() : Promise<void>
    {
        conflict.value = false;
        await runSave(true);
    }

    function dismissConflict() : void
    {
        conflict.value = false;
    }

    //------------------------------------------------------------------------------------------------------------------

    function reset() : void
    {
        clearAutosave();
        node.value = null;
        buffer.value = '';
        savedText.value = '';
        loadedBlobID.value = null;
        mode.value = 'plain';
        loadState.value = 'idle';
        loadError.value = null;
        saving.value = false;
        saveError.value = null;
        conflict.value = false;
        lastSavedAt.value = null;
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        node,
        buffer,
        mode,
        autosaveEnabled,
        loadState,
        loadError,
        saving,
        saveError,
        conflict,
        lastSavedAt,
        dirty,
        readOnly,
        open,
        setBuffer,
        setMode,
        save,
        reload,
        overwrite,
        dismissConflict,
        reset,
    };
});

//----------------------------------------------------------------------------------------------------------------------
