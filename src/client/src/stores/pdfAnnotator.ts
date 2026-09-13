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
// The store does not import pdf.js. Everything it needs of a live document -- the bytes to save, a thumbnail, an
// attachment's content, a jump to an outline destination, undo and redo -- comes from an access object the surface
// registers once a document is open, which keeps this whole pipeline testable without a renderer.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { type NodeResponse, PDF_ANNOTATOR_MAX_BYTES, type UploadCommitMetadata, isRoleAtLeast } from '@fileshed/core';

// Resource Access
import { ApiError } from '../resource-access/apiError.ts';
import { answerChallenge, claimBlob, uploadTicket } from '../resource-access/blobs.ts';
import { fetchNodeBlob } from '../resource-access/content.ts';
import { downloadUrl, saveBytes, showBytesIn } from '../resource-access/downloads.ts';
import { getNode, patchNode } from '../resource-access/nodes.ts';

// Engines
import { computeProofAnswer } from '../engines/claim.ts';

// Utils
import { hashFile, readSampleWindows } from '../utils/hashFile.ts';
import { describeApiError } from '../utils/runWithToast.ts';

// Components
import {
    type AltTextRequest,
    type AnnotationMode,
    type CursorTool,
    DEFAULT_ZOOM,
    type DocumentProperties,
    type EditorParams,
    type FindOptions,
    type FindQuery,
    type HighlightParams,
    type InkParams,
    type OutlineDestination,
    type OutlineEntry,
    type PdfAttachment,
    ROTATION_STEP,
    type ScrollModeName,
    type SidebarTab,
    type SpreadModeName,
    type TextParams,
    defaultEditorParams,
    defaultFindOptions,
    zoomLadder,
} from '../components/handlers/pdf/types.ts';

//----------------------------------------------------------------------------------------------------------------------

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

// What the store can ask of a live document, registered by the surface once one is open. Held out of reactive state:
// it is machinery, not view data, and it is the only way anything outside the surface reaches the renderer.
//
// View state the renderer should follow (mode, zoom, rotation, layout) stays as plain reactive state that the surface
// watches. These are the calls that go the other way -- a question or a one-shot command, with no state to mirror.
interface PdfDocumentAccess
{
    save : () => Promise<Uint8Array>;

    // The same bytes a save would write, without declaring the marks saved. Printing needs the document; it has not
    // earned the right to clear the unsaved-marks flag.
    serialize : () => Promise<Uint8Array>;
    renderThumbnail : (page : number, canvas : HTMLCanvasElement, width : number) => Promise<void>;
    readAttachment : (id : string) => Promise<Uint8Array | null>;
    goToDestination : (dest : OutlineDestination) => void;
    addImage : () => void;
    undo : () => void;
    redo : () => void;
}

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

    // How pages are laid out in the scroll container, and what a drag on the page does. The layout pair is handed
    // straight to the renderer; the cursor tool is the surface's own behavior and never reaches pdf.js.
    const scrollMode = ref<ScrollModeName>('vertical');
    const spreadMode = ref<SpreadModeName>('none');
    const cursorTool = ref<CursorTool>('select');

    // The navigation rail: whether it is open, which tab it shows, and the two documents facts it lists. The outline
    // and attachments are read once when the document opens and are empty for a document carrying neither.
    const sidebarOpen = ref(false);
    const sidebarTab = ref<SidebarTab>('thumbnails');
    const outline = ref<OutlineEntry[]>([]);
    const attachments = ref<PdfAttachment[]>([]);

    // Whether the document is filling the screen. Set by the surface once the browser confirms the change rather than
    // when it is asked for, since the reader can leave fullscreen by a route this app never hears about (Escape).
    const presenting = ref(false);

    const properties = ref<DocumentProperties | null>(null);
    const propertiesOpen = ref(false);

    // An image annotation's description, while the dialog asking for it is open. The annotation that asked is held
    // outside reactive state, like the document access is: it is a way back to the renderer, not something to render.
    const altTextOpen = ref(false);
    const altText = ref('');
    const altTextDecorative = ref(false);

    // Whether the annotation editor has anything to step back or forward through, as the renderer reports it.
    const canUndo = ref(false);
    const canRedo = ref(false);

    // In-page search. The query text, the toggles, and the match tally are display state the find bar binds to;
    // findRequest is an edge-triggered command the surface watches -- its nonce forces a fresh dispatch even when the
    // query text is unchanged (the next/prev walk over the same term).
    const findOpen = ref(false);
    const findQuery = ref('');
    const findOptions = ref<FindOptions>(defaultFindOptions());
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
    const printing = ref(false);
    const printError = ref<string | null>(null);
    const conflict = ref(false);
    const lastSavedAt = ref<number | null>(null);

    // Raised by the surface when the annotation layer gains unsaved marks, cleared on save and load. The Save control
    // gates on it; the store trusts it rather than diffing bytes, since only the renderer knows the editor's state.
    const dirty = ref(false);

    let access : PdfDocumentAccess | null = null;
    let altTextApply : AltTextRequest['apply'] | null = null;

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
        if(saving.value || node.value === null || readOnly.value || access === null) { return; }

        saving.value = true;
        saveError.value = null;

        try
        {
            const out = await access.save();
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

    function setDocumentAccess(source : PdfDocumentAccess | null) : void
    {
        access = source;
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
    function nextPage() : void { goToPage(currentPage.value + 1); }
    function prevPage() : void { goToPage(currentPage.value - 1); }

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

    // Every dispatched search is the query box plus the current toggles; only the walk's direction and whether this is
    // a repeat over the same term vary between them.
    function buildQuery(findPrevious : boolean, again : boolean) : FindQuery & { seq : number }
    {
        return {
            query: findQuery.value,
            ...findOptions.value,
            findPrevious,
            again,
            seq: ++commandSeq,
        };
    }

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

        findRequest.value = buildQuery(false, false);
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

    // Flip one of the search toggles and re-run the term already in the box, so a reader who narrows a search sees the
    // narrowed tally without retyping anything.
    function toggleFindOption(option : keyof FindOptions) : void
    {
        findOptions.value = { ...findOptions.value, [option]: !findOptions.value[option] };
        runFind();
    }

    // Walk to the next/previous match of the term already in the box. A repeat over the same query, so it dispatches an
    // `again` search rather than a fresh one; with no query there is nothing to walk.
    function stepFind(findPrevious : boolean) : void
    {
        if(findQuery.value.trim() === '') { return; }

        findRequest.value = buildQuery(findPrevious, true);
    }

    function findNext() : void { stepFind(false); }
    function findPrev() : void { stepFind(true); }

    function setFindResult(current : number, total : number) : void
    {
        findCurrent.value = current;
        findTotal.value = total;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Layout and cursor
    //------------------------------------------------------------------------------------------------------------------

    function setScrollMode(next : ScrollModeName) : void { scrollMode.value = next; }
    function setSpreadMode(next : SpreadModeName) : void { spreadMode.value = next; }
    function setCursorTool(next : CursorTool) : void { cursorTool.value = next; }

    //------------------------------------------------------------------------------------------------------------------
    // Sidebar
    //------------------------------------------------------------------------------------------------------------------

    function toggleSidebar() : void { sidebarOpen.value = !sidebarOpen.value; }

    // Choosing a tab opens the rail: a reader who picks Outline from a closed rail wants to see the outline, not to
    // arm a choice that takes a second press to reveal.
    function showSidebarTab(tab : SidebarTab) : void
    {
        sidebarTab.value = tab;
        sidebarOpen.value = true;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Document facts, reported by the surface
    //------------------------------------------------------------------------------------------------------------------

    // The outline, attachments, and properties a freshly opened document carries. The rail falls back to thumbnails
    // when the tab it was left on has nothing behind it, so a reader moving between documents is never handed a pane
    // that is blank for a reason they cannot see.
    function setDocumentFacts(
        facts : { outline : OutlineEntry[]; attachments : PdfAttachment[]; properties : DocumentProperties }
    ) : void
    {
        outline.value = facts.outline;
        attachments.value = facts.attachments;
        properties.value = facts.properties;

        const emptyTab = (sidebarTab.value === 'outline' && facts.outline.length === 0)
            || (sidebarTab.value === 'attachments' && facts.attachments.length === 0);

        if(emptyTab) { sidebarTab.value = 'thumbnails'; }
    }

    function setEditorHistory(undoable : boolean, redoable : boolean) : void
    {
        canUndo.value = undoable;
        canRedo.value = redoable;
    }

    function setPresenting(value : boolean) : void { presenting.value = value; }

    //------------------------------------------------------------------------------------------------------------------
    // Asking the document
    //------------------------------------------------------------------------------------------------------------------

    function goToDestination(dest : OutlineDestination) : void
    {
        access?.goToDestination(dest);
    }

    // A thumbnail is painted into a canvas the rail owns. With no live document there is nothing to paint and the
    // canvas is left as it was, which is blank.
    async function renderThumbnail(page : number, canvas : HTMLCanvasElement, width : number) : Promise<void>
    {
        await access?.renderThumbnail(page, canvas, width);
    }

    // Save one embedded file out of the document. The bytes never leave the browser -- the renderer reads them out of
    // the PDF it already holds -- and the type is generic, because an embedded file declares a name and not a type.
    async function saveAttachment(id : string, filename : string) : Promise<void>
    {
        const content = await access?.readAttachment(id) ?? null;
        if(content === null) { return; }

        saveBytes(content, filename, 'application/octet-stream');
    }

    // Placing an image is a command, not a mode the way the other tools are: pdf.js makes the editor the moment it is
    // asked, and the file picker follows. Arming the mode alone leaves the tool inert, and pressing the button again
    // while it is already armed has to place another image rather than do nothing.
    function addImage() : void
    {
        if(readOnly.value) { return; }

        mode.value = 'stamp';
        access?.addImage();
    }

    function undo() : void { if(!readOnly.value) { access?.undo(); } }
    function redo() : void { if(!readOnly.value) { access?.redo(); } }

    function openProperties() : void { propertiesOpen.value = true; }
    function closeProperties() : void { propertiesOpen.value = false; }

    //------------------------------------------------------------------------------------------------------------------
    // Alt text
    //------------------------------------------------------------------------------------------------------------------

    // Raised by the renderer when a reader presses an image annotation's description button.
    function openAltText(request : AltTextRequest) : void
    {
        altText.value = request.altText;
        altTextDecorative.value = request.decorative;
        altTextApply = request.apply;
        altTextOpen.value = true;
    }

    function closeAltText() : void
    {
        altTextOpen.value = false;
        altTextApply = null;
    }

    // A decorative image is the statement that there is nothing to describe, so it is saved with no description
    // rather than with one nothing will ever read.
    function saveAltText(text : string, decorative : boolean) : void
    {
        altTextApply?.(decorative ? '' : text.trim(), decorative);
        closeAltText();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Print
    //------------------------------------------------------------------------------------------------------------------

    // Print what is on screen, unsaved marks included, by handing the browser the annotated document and letting its
    // own PDF viewer print it -- full fidelity, and exactly the bytes a save would write. It goes to a new tab rather
    // than a hidden frame because the app's Content-Security-Policy permits no framing at all, and weakening that for
    // a print button is a poor trade.
    //
    // The tab is opened before anything is awaited: a window.open that is not the direct consequence of a click is not
    // a user gesture, and a popup blocker refuses it.
    async function print() : Promise<void>
    {
        const current = node.value;
        if(current === null) { return; }

        if(access === null)
        {
            window.open(downloadUrl(current.id, 'inline'), '_blank', 'noopener');
            return;
        }

        const target = window.open('', '_blank', 'noopener');
        if(target === null)
        {
            printError.value = 'Your browser blocked the print tab. Allow pop-ups for this site and try again.';
            return;
        }

        printing.value = true;
        printError.value = null;

        try
        {
            showBytesIn(target, await access.serialize(), 'application/pdf');
        }
        catch(caught)
        {
            target.close();
            printError.value = describeApiError(caught);
        }
        finally
        {
            printing.value = false;
        }
    }

    // The view-only state (rotation, editor params, search) a fresh load or a reset clears back to defaults.
    function resetView() : void
    {
        rotation.value = 0;
        scrollMode.value = 'vertical';
        spreadMode.value = 'none';
        cursorTool.value = 'select';
        canUndo.value = false;
        canRedo.value = false;
        propertiesOpen.value = false;
        printError.value = null;
        altTextOpen.value = false;
        altTextApply = null;
        editorParams.value = defaultEditorParams();
        findOpen.value = false;
        findQuery.value = '';
        findOptions.value = defaultFindOptions();
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
        outline.value = [];
        attachments.value = [];
        properties.value = null;
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
        access = null;
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
        printing.value = false;
        conflict.value = false;
        lastSavedAt.value = null;
        dirty.value = false;
        outline.value = [];
        attachments.value = [];
        properties.value = null;
        sidebarOpen.value = false;
        sidebarTab.value = 'thumbnails';
        presenting.value = false;
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
        findOptions,
        findCurrent,
        findTotal,
        findRequest,
        pageRequest,
        loadState,
        loadError,
        saving,
        saveError,
        printing,
        printError,
        conflict,
        lastSavedAt,
        dirty,
        readOnly,
        scrollMode,
        spreadMode,
        cursorTool,
        sidebarOpen,
        sidebarTab,
        outline,
        attachments,
        presenting,
        properties,
        propertiesOpen,
        altTextOpen,
        altText,
        altTextDecorative,
        canUndo,
        canRedo,
        open,
        save,
        print,
        setDocumentAccess,
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
        nextPage,
        prevPage,
        updateHighlight,
        updateText,
        updateInk,
        openFind,
        closeFind,
        setFindQuery,
        toggleFindOption,
        findNext,
        findPrev,
        setFindResult,
        setScrollMode,
        setSpreadMode,
        setCursorTool,
        toggleSidebar,
        showSidebarTab,
        setDocumentFacts,
        setEditorHistory,
        setPresenting,
        goToDestination,
        addImage,
        renderThumbnail,
        saveAttachment,
        undo,
        redo,
        openProperties,
        closeProperties,
        openAltText,
        closeAltText,
        saveAltText,
        reload,
        overwrite,
        dismissConflict,
        rename,
        reset,
    };
});

//----------------------------------------------------------------------------------------------------------------------
