//----------------------------------------------------------------------------------------------------------------------
// PDF Annotator Store
//
// The open-PDF annotation session: load a PDF's bytes, track whether the annotation layer has unsaved marks, and save
// the annotated document back through the same claim / proof-of-possession / replace flow an upload uses -- so a save
// dedups against known content and preserves the node's id, links, and shares. This is a sibling of the text editor
// store, not a reuse of it: the editing surface here deals in BYTES (a Uint8Array pdf.js produces from saveDocument),
// not a text buffer, so there is no string diff, no source mode, and no per-keystroke dirty signal to diff against.
//
// Saves are EXPLICIT only -- never autosaved. A text buffer is coherent at every keystroke, so debounced autosave is
// safe there; an annotation session is not. Autosaving mid-gesture would serialize a half-drawn ink stroke or a
// partially placed text box as if it were finished. The user decides when the page is in a saveable state and presses
// Save. Each save re-arms the optimistic-concurrency guard with the blob it just wrote, so a stale save (someone else
// saved first) is refused with a conflict the user resolves by reloading or overwriting.
//
// The store does not import pdf.js. The bytes to save come from a save source the surface registers once it has a live
// document -- the single seam across the pdf.js boundary, which keeps this whole pipeline testable without a renderer.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { type NodeResponse, PDF_ANNOTATOR_MAX_BYTES, type UploadCommitMetadata, isRoleAtLeast } from '@fileshed/core';

// Resource Access
import { ApiError } from '../resource-access/apiError.ts';
import { answerChallenge, claimBlob, uploadTicket } from '../resource-access/blobs.ts';
import { fetchNodeBlob } from '../resource-access/content.ts';
import { getNode, patchNode } from '../resource-access/nodes.ts';

// Engines
import { computeProofAnswer } from '../engines/claim.ts';

// Utils
import { hashFile, readSampleWindows } from '../utils/hashFile.ts';
import { describeApiError } from '../utils/runWithToast.ts';

// Components
import {
    type AnnotationMode,
    DEFAULT_ZOOM,
    type EditorParams,
    type FindQuery,
    type HighlightParams,
    type InkParams,
    ROTATION_STEP,
    type TextParams,
    defaultEditorParams,
    zoomLadder,
} from '../components/handlers/pdf/types.ts';

//----------------------------------------------------------------------------------------------------------------------

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

// Produces the current annotated document as bytes -- the surface's saveDocument call, registered once a document is
// live. Held out of reactive state: it is machinery, not view data.
type SaveSource = () => Promise<Uint8Array>;

//----------------------------------------------------------------------------------------------------------------------

export const usePdfAnnotatorStore = defineStore('pdfAnnotator', () =>
{
    const node = ref<NodeResponse | null>(null);
    const bytes = ref<Uint8Array | null>(null);

    // The blob the bytes were loaded from and re-armed to on each save: the ifBlobID guard a save pins itself to.
    const loadedBlobID = ref<string | null>(null);

    const mode = ref<AnnotationMode>('none');

    // The surface's view state, coordinated between the toolbar (which reads the page indicator and drives zoom) and
    // the surface (which reports the scrolled-to page and applies the zoom to the renderer).
    const pageCount = ref(0);
    const currentPage = ref(1);
    const zoom = ref<string>(DEFAULT_ZOOM);
    const rotation = ref(0);

    // The annotation editor parameters (colors, thicknesses, sizes). Owned here, applied to the renderer by the
    // surface, re-applied on a remount so a reload keeps the chosen tool settings.
    const editorParams = ref<EditorParams>(defaultEditorParams());

    // In-page search. The query text, case toggle, and match tally are display state the find bar binds to; findRequest
    // is an edge-triggered command the surface watches -- its nonce forces a fresh dispatch even when the query text is
    // unchanged (the next/prev walk over the same term).
    const findOpen = ref(false);
    const findQuery = ref('');
    const findCaseSensitive = ref(false);
    const findCurrent = ref(0);
    const findTotal = ref(0);
    const findRequest = ref<(FindQuery & { seq : number }) | null>(null);

    // A page jump the toolbar commands, distinct from the currentPage the surface reports as it scrolls. The nonce lets
    // a jump to the page already shown still re-issue.
    const pageRequest = ref<{ page : number; seq : number } | null>(null);

    // A monotonic source for the command nonces above.
    let commandSeq = 0;

    const loadState = ref<LoadState>('idle');
    const loadError = ref<string | null>(null);

    const saving = ref(false);
    const saveError = ref<string | null>(null);
    const conflict = ref(false);
    const lastSavedAt = ref<number | null>(null);

    // Raised by the surface when the annotation layer gains unsaved marks, cleared on save and load. The Save control
    // gates on it; the store trusts it rather than diffing bytes, since only the renderer knows the editor's state.
    const dirty = ref(false);

    let saveSource : SaveSource | null = null;

    //------------------------------------------------------------------------------------------------------------------

    // A viewer (or no loaded node) annotates nothing: the surface renders view-only and never saves. Editor-or-owner
    // annotates.
    const readOnly = computed(() => node.value === null || !isRoleAtLeast(node.value.role, 'editor'));

    //------------------------------------------------------------------------------------------------------------------
    // Save
    //------------------------------------------------------------------------------------------------------------------

    // Wrap the saved bytes in a File so the same streaming hash the upload flow keys claims on, and the same sampled
    // window reads a proof-of-possession answer is computed over, run against the exact bytes being written.
    async function hashBytes(out : Uint8Array, name : string) : Promise<{ sha : string; file : File }>
    {
        const file = new File([ new Uint8Array(out) ], name, { type: 'application/pdf' });
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

    // One save pass over the current annotated document. A body that already hashes to the node's blob is the cheapest
    // no-op -- nothing is written. Otherwise the write re-arms the guard to the blob it just landed and clears the
    // conflict.
    async function performSave(out : Uint8Array, force : boolean) : Promise<void>
    {
        const current = node.value;
        if(current === null) { return; }

        const { sha, file } = await hashBytes(out, current.name);

        if(sha === loadedBlobID.value)
        {
            dirty.value = false;
            return;
        }

        const guard = force ? undefined : (loadedBlobID.value ?? undefined);
        const saved = await commitReplace(current.id, file, sha, guard);

        node.value = saved;
        if(saved.type === 'file') { loadedBlobID.value = saved.blobID; }
        dirty.value = false;
        lastSavedAt.value = Date.now();
        conflict.value = false;
    }

    // The one save path both triggers funnel through. saving is raised synchronously so a second press while a save
    // runs returns rather than starting a second in-flight save. force drops the guard, the "Overwrite" resolution to
    // a conflict. With no registered save source (no live document) there is nothing to write.
    async function runSave(force : boolean) : Promise<void>
    {
        if(saving.value || node.value === null || readOnly.value || saveSource === null) { return; }

        saving.value = true;
        saveError.value = null;

        try
        {
            const out = await saveSource();
            await performSave(out, force);
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
    // Surface seam
    //------------------------------------------------------------------------------------------------------------------

    function setSaveSource(source : SaveSource | null) : void
    {
        saveSource = source;
    }

    function setDirty(value : boolean) : void
    {
        dirty.value = value;
    }

    function setMode(next : AnnotationMode) : void
    {
        // A read-only session has no annotation mode to be in; a stray toggle stays at none.
        mode.value = readOnly.value ? 'none' : next;
    }

    function setPage(current : number, total : number) : void
    {
        currentPage.value = current;
        pageCount.value = total;
    }

    function setZoom(value : string) : void
    {
        zoom.value = value;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Zoom / rotate / page
    //------------------------------------------------------------------------------------------------------------------

    // Walk the absolute-scale ladder one rung. A named preset (auto / fit) has no rung, so a step starts from 100% --
    // only the renderer knows a fit mode's real scale, and the store deliberately does not import it.
    function stepZoom(direction : number) : void
    {
        const current = zoomLadder.indexOf(zoom.value);
        const base = current === -1 ? zoomLadder.indexOf('1') : current;
        const next = Math.min(Math.max(base + direction, 0), zoomLadder.length - 1);
        const value = zoomLadder[next];
        if(value !== undefined) { zoom.value = value; }
    }

    function zoomIn() : void { stepZoom(1); }
    function zoomOut() : void { stepZoom(-1); }

    function rotateCW() : void { rotation.value = (rotation.value + ROTATION_STEP) % 360; }
    function rotateCCW() : void { rotation.value = (rotation.value + 360 - ROTATION_STEP) % 360; }

    // Command a jump to a page, clamped into range and rounded to a whole page. The clamp needs a live page count; a
    // not-yet-loaded document (count 0) pins to page 1.
    function goToPage(page : number) : void
    {
        if(!Number.isFinite(page)) { return; }

        const max = Math.max(pageCount.value, 1);
        const target = Math.min(Math.max(Math.round(page), 1), max);
        currentPage.value = target;
        pageRequest.value = { page: target, seq: ++commandSeq };
    }

    function firstPage() : void { goToPage(1); }
    function lastPage() : void { goToPage(pageCount.value); }

    //------------------------------------------------------------------------------------------------------------------
    // Annotation editor params
    //------------------------------------------------------------------------------------------------------------------

    function updateHighlight(patch : Partial<HighlightParams>) : void
    {
        editorParams.value.highlight = { ...editorParams.value.highlight, ...patch };
    }

    function updateText(patch : Partial<TextParams>) : void
    {
        editorParams.value.text = { ...editorParams.value.text, ...patch };
    }

    function updateInk(patch : Partial<InkParams>) : void
    {
        editorParams.value.ink = { ...editorParams.value.ink, ...patch };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Find
    //------------------------------------------------------------------------------------------------------------------

    // Issue a fresh search over the current query, or clear the tally when the query is empty. Empty clears findRequest
    // so the surface knows to drop any live highlight.
    function runFind() : void
    {
        if(findQuery.value.trim() === '')
        {
            findCurrent.value = 0;
            findTotal.value = 0;
            findRequest.value = null;
            return;
        }

        findRequest.value = {
            query: findQuery.value,
            caseSensitive: findCaseSensitive.value,
            highlightAll: true,
            findPrevious: false,
            again: false,
            seq: ++commandSeq,
        };
    }

    function openFind() : void
    {
        findOpen.value = true;
        if(findQuery.value.trim() !== '') { runFind(); }
    }

    function closeFind() : void
    {
        findOpen.value = false;
        findQuery.value = '';
        findCurrent.value = 0;
        findTotal.value = 0;
        findRequest.value = null;
    }

    function setFindQuery(value : string) : void
    {
        findQuery.value = value;
        runFind();
    }

    function toggleFindCase() : void
    {
        findCaseSensitive.value = !findCaseSensitive.value;
        runFind();
    }

    // Walk to the next/previous match of the term already in the box. A repeat over the same query, so it dispatches an
    // `again` search rather than a fresh one; with no query there is nothing to walk.
    function stepFind(findPrevious : boolean) : void
    {
        if(findQuery.value.trim() === '') { return; }

        findRequest.value = {
            query: findQuery.value,
            caseSensitive: findCaseSensitive.value,
            highlightAll: true,
            findPrevious,
            again: true,
            seq: ++commandSeq,
        };
    }

    function findNext() : void { stepFind(false); }
    function findPrev() : void { stepFind(true); }

    function setFindResult(current : number, total : number) : void
    {
        findCurrent.value = current;
        findTotal.value = total;
    }

    // The view-only state (rotation, editor params, search) a fresh load or a reset clears back to defaults.
    function resetView() : void
    {
        rotation.value = 0;
        editorParams.value = defaultEditorParams();
        findOpen.value = false;
        findQuery.value = '';
        findCaseSensitive.value = false;
        findCurrent.value = 0;
        findTotal.value = 0;
        findRequest.value = null;
        pageRequest.value = null;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Load
    //------------------------------------------------------------------------------------------------------------------

    async function open(nodeID : string) : Promise<void>
    {
        loadState.value = 'loading';
        loadError.value = null;
        saveError.value = null;
        conflict.value = false;
        lastSavedAt.value = null;
        dirty.value = false;
        mode.value = 'none';
        pageCount.value = 0;
        currentPage.value = 1;
        zoom.value = DEFAULT_ZOOM;
        resetView();

        try
        {
            const loaded = await getNode(nodeID);
            node.value = loaded;

            if(loaded.type !== 'file')
            {
                loadState.value = 'error';
                loadError.value = 'This item can\'t be annotated.';
                return;
            }
            if(loaded.size > PDF_ANNOTATOR_MAX_BYTES)
            {
                loadState.value = 'error';
                loadError.value = 'This PDF is too large to annotate here. Download it to work with the whole file.';
                return;
            }

            const blob = await fetchNodeBlob(nodeID);
            bytes.value = new Uint8Array(await blob.arrayBuffer());
            loadedBlobID.value = loaded.blobID;
            loadState.value = 'ready';
        }
        catch(caught)
        {
            node.value = null;
            bytes.value = null;
            loadState.value = 'error';
            loadError.value = describeApiError(caught);
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Conflict resolution
    //------------------------------------------------------------------------------------------------------------------

    // Discard local annotations and reload the server's current bytes -- the "Reload" resolution to a conflict.
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

    // Rename the open file in place. The node is replaced with the server's response, so later saves carry the new
    // name and the freshened timestamps without a reload.
    async function rename(name : string) : Promise<void>
    {
        const current = node.value;
        const trimmed = name.trim();
        if(current === null || readOnly.value || trimmed.length === 0 || trimmed === current.name) { return; }

        node.value = await patchNode(current.id, { name: trimmed });
    }

    //------------------------------------------------------------------------------------------------------------------

    function reset() : void
    {
        saveSource = null;
        node.value = null;
        bytes.value = null;
        loadedBlobID.value = null;
        mode.value = 'none';
        pageCount.value = 0;
        currentPage.value = 1;
        zoom.value = DEFAULT_ZOOM;
        loadState.value = 'idle';
        loadError.value = null;
        saving.value = false;
        saveError.value = null;
        conflict.value = false;
        lastSavedAt.value = null;
        dirty.value = false;
        resetView();
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        node,
        bytes,
        mode,
        pageCount,
        currentPage,
        zoom,
        rotation,
        editorParams,
        findOpen,
        findQuery,
        findCaseSensitive,
        findCurrent,
        findTotal,
        findRequest,
        pageRequest,
        loadState,
        loadError,
        saving,
        saveError,
        conflict,
        lastSavedAt,
        dirty,
        readOnly,
        open,
        save,
        setSaveSource,
        setDirty,
        setMode,
        setPage,
        setZoom,
        zoomIn,
        zoomOut,
        rotateCW,
        rotateCCW,
        goToPage,
        firstPage,
        lastPage,
        updateHighlight,
        updateText,
        updateInk,
        openFind,
        closeFind,
        setFindQuery,
        toggleFindCase,
        findNext,
        findPrev,
        setFindResult,
        reload,
        overwrite,
        dismissConflict,
        rename,
        reset,
    };
});

//----------------------------------------------------------------------------------------------------------------------
