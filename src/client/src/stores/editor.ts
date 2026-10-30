//----------------------------------------------------------------------------------------------------------------------
// Editor Store
//
// An explicit save (button or Cmd/Ctrl+S) and the debounced autosave share one save and are serialized: never two saves
// in flight, and an explicit save cancels a pending autosave.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { EDITOR_MAX_BYTES } from '@fileshed/core';

// Resource Access
import { fetchNodeText } from '../resource-access/content.ts';
import { getNode } from '../resource-access/nodes.ts';

// Engines
import { type EditorMode, intent } from '../engines/intent/index.ts';

// Stores
import { type SaveWriter, createFileSaveSession } from './fileSaveSession.ts';

// Utils
import { describeApiError } from '../utils/runWithToast.ts';

//----------------------------------------------------------------------------------------------------------------------

// The quiet period after the last edit before an autosave fires. Long enough that a burst of typing debounces to one
// save, short enough that a pause is captured before the user tabs away.
const AUTOSAVE_DEBOUNCE_MS = 2000;

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

//----------------------------------------------------------------------------------------------------------------------

export const useEditorStore = defineStore('editor', () =>
{
    const file = createFileSaveSession();

    const buffer = ref('');
    const savedText = ref('');

    const mode = ref<EditorMode>('plain');
    const autosaveEnabled = ref(true);

    const loadState = ref<LoadState>('idle');
    const loadError = ref<string | null>(null);

    // The pending autosave timer, kept out of reactive state -- it is machinery, not view data.
    let autosaveTimer : ReturnType<typeof setTimeout> | null = null;

    //------------------------------------------------------------------------------------------------------------------

    const dirty = computed(() => buffer.value !== savedText.value);

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

    // Save, then converge: edits that landed while the save was in flight leave the buffer dirty, so keep saving until
    // it settles (only while autosave is on, and never past a conflict). A follow-up pass never inherits an overwrite's
    // dropped guard -- once the first write lands, later passes guard against what it wrote.
    async function saveUntilClean(write : SaveWriter, force : boolean) : Promise<void>
    {
        const current = file.node.value;
        if(current === null) { return; }

        const text = buffer.value;
        if(!await write(new File([ text ], current.name), force)) { return; }

        savedText.value = text;

        if(dirty.value && autosaveEnabled.value && !file.conflict.value && !file.readOnly.value)
        {
            await saveUntilClean(write, false);
        }
    }

    async function runSave(force : boolean) : Promise<void>
    {
        clearAutosave();
        await file.save((write) => saveUntilClean(write, force));
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
        if(!autosaveEnabled.value || file.readOnly.value) { return; }

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
        const token = file.begin();
        loadState.value = 'loading';
        loadError.value = null;

        try
        {
            const loaded = await getNode(nodeID);
            if(!file.isCurrent(token)) { return; }
            file.node.value = loaded;

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
            if(!file.isCurrent(token)) { return; }

            buffer.value = text;
            savedText.value = text;
            file.loadedBlobID.value = loaded.blobID;
            mode.value = intent.handlers.defaultEditorMode(loaded.mimeType, loaded.name);
            loadState.value = 'ready';
        }
        catch(caught)
        {
            if(!file.isCurrent(token)) { return; }

            file.node.value = null;
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
        const current = file.node.value;
        if(current === null) { return; }

        await open(current.id);
    }

    // Retry the save without the guard, clobbering whatever landed first -- the "Overwrite" resolution.
    async function overwrite() : Promise<void>
    {
        file.dismissConflict();
        await runSave(true);
    }

    //------------------------------------------------------------------------------------------------------------------

    function reset() : void
    {
        clearAutosave();
        file.close();
        buffer.value = '';
        savedText.value = '';
        mode.value = 'plain';
        loadState.value = 'idle';
        loadError.value = null;
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        node: file.node,
        buffer,
        mode,
        autosaveEnabled,
        loadState,
        loadError,
        saving: file.saving,
        saveError: file.saveError,
        conflict: file.conflict,
        lastSavedAt: file.lastSavedAt,
        dirty,
        readOnly: file.readOnly,
        open,
        setBuffer,
        setMode,
        save,
        reload,
        overwrite,
        dismissConflict: file.dismissConflict,
        rename: file.rename,
        reset,
    };
});

//----------------------------------------------------------------------------------------------------------------------
