//----------------------------------------------------------------------------------------------------------------------
// pdf.js Binding
//
// The single seam across the pdf.js boundary: everything that touches the renderer lives here, so the surface drives
// PDFs through a small, house-shaped API and the rest of the family (store, toolbar, tests) never imports pdf.js.
//
// It is built on pdfjs-dist's viewer *components* (PDFViewer + EventBus + PDFLinkService + PDFFindController), not the
// prebuilt Mozilla viewer HTML. That is a deliberate call: PDFViewer already does the hard parts correctly and
// version-stably -- lazy page rendering (only visible pages plus a buffer rasterize), the selectable text layer, the
// find controller wired to the text layer, and the AnnotationEditorLayer wired to a shared editor UI manager.
// Hand-rolling any of that against pdf.js internals is a standing invitation to break on every pdf.js bump. We still
// own the container, the toolbar, and the save -- a custom integration, just not a reimplementation of the plumbing.
//
// pdf.js cannot edit existing page content. The annotation editors add marks OVER the page (free text, ink, highlight);
// saveDocument serializes those, plus any AcroForm field values, as an incremental update to the original bytes -- a
// real, valid PDF, not a re-render. The worker is bundled (Vite ?url import), never fetched from a CDN, so a
// self-hosted deployment carries its own renderer.
//----------------------------------------------------------------------------------------------------------------------

import { AnnotationEditorParamsType, AnnotationEditorType, GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Components
import { type AnnotationMode, DEFAULT_ZOOM, type EditorParams, type FindQuery } from './types.ts';

//----------------------------------------------------------------------------------------------------------------------

// The worker ships with the app; set once at module load, before any getDocument call.
GlobalWorkerOptions.workerSrc = workerSrc;

const EDITOR_TYPE : Record<AnnotationMode, number>
    = {
        none: AnnotationEditorType.NONE,
        freetext: AnnotationEditorType.FREETEXT,
        ink: AnnotationEditorType.INK,
        highlight: AnnotationEditorType.HIGHLIGHT,
    };

//----------------------------------------------------------------------------------------------------------------------

export interface PdfSessionCallbacks
{
    onPage : (current : number, total : number) => void;
    onDirty : (dirty : boolean) => void;
    onFind : (current : number, total : number) => void;
}

export interface PdfSession
{
    setMode : (mode : AnnotationMode) => void;
    setZoom : (value : string) => void;
    setRotation : (degrees : number) => void;
    setPage : (page : number) => void;
    setParams : (params : EditorParams) => void;
    find : (query : FindQuery) => void;
    clearFind : () => void;
    save : () => Promise<Uint8Array>;
    destroy : () => void;
}

export interface PdfSessionOptions
{
    container : HTMLDivElement;
    viewer : HTMLDivElement;
    data : Uint8Array;
    readOnly : boolean;
    callbacks : PdfSessionCallbacks;
}

//----------------------------------------------------------------------------------------------------------------------

// Payload shapes read off the event bus. pdf.js does not type its bus events, so the reads it exposes are narrowed here
// to just the fields consumed.
interface PageChangingEvent { pageNumber : number; }
interface FindMatchesEvent { matchesCount : { current : number; total : number }; }

//----------------------------------------------------------------------------------------------------------------------

export async function openPdfSession(options : PdfSessionOptions) : Promise<PdfSession>
{
    const { container, viewer, data, readOnly, callbacks } = options;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });

    const pdfViewer = new PDFViewer({
        container,
        viewer,
        eventBus,
        linkService,
        findController,
        annotationEditorMode: readOnly ? AnnotationEditorType.DISABLE : AnnotationEditorType.NONE,
    });
    linkService.setViewer(pdfViewer);

    // The viewer initializes asynchronously after setDocument: the annotation editor's UI manager and the page layout
    // each arrive on their own bus events, and assigning a mode, editor params, a scale, a rotation, a page, or a
    // search before then throws or lands nowhere. Requests that arrive early are parked and applied the moment the
    // viewer says that layer is ready.
    let editorReady = false;
    let pendingMode : AnnotationMode | null = null;
    let pendingParams : EditorParams | null = null;

    let pagesReady = false;
    let pendingZoom : string | null = null;
    let pendingRotation : number | null = null;
    let pendingPage : number | null = null;
    let pendingFind : FindQuery | null = null;

    function dispatchParam(type : number, value : string | number | boolean) : void
    {
        eventBus.dispatch('switchannotationeditorparams', { source: pdfViewer, type, value });
    }

    // Push every editor param at once. pdf.js stores each as the default for new marks of that type and applies it to
    // any selected mark, so re-pushing the whole set is idempotent. Opacity is the toolbar's percent; pdf.js wants
    // a 0..1 fraction.
    function applyParams(params : EditorParams) : void
    {
        dispatchParam(AnnotationEditorParamsType.HIGHLIGHT_COLOR, params.highlight.color);
        dispatchParam(AnnotationEditorParamsType.HIGHLIGHT_THICKNESS, params.highlight.thickness);
        dispatchParam(AnnotationEditorParamsType.HIGHLIGHT_SHOW_ALL, params.highlight.showAll);
        dispatchParam(AnnotationEditorParamsType.FREETEXT_COLOR, params.text.color);
        dispatchParam(AnnotationEditorParamsType.FREETEXT_SIZE, params.text.size);
        dispatchParam(AnnotationEditorParamsType.INK_COLOR, params.ink.color);
        dispatchParam(AnnotationEditorParamsType.INK_THICKNESS, params.ink.thickness);
        dispatchParam(AnnotationEditorParamsType.INK_OPACITY, params.ink.opacity / 100);
    }

    function dispatchFind(query : FindQuery) : void
    {
        eventBus.dispatch('find', {
            source: pdfViewer,
            type: query.again ? 'again' : '',
            query: query.query,
            caseSensitive: query.caseSensitive,
            entireWord: false,
            highlightAll: query.highlightAll,
            findPrevious: query.findPrevious,
            matchDiacritics: false,
        });
    }

    eventBus.on('annotationeditoruimanager', () =>
    {
        editorReady = true;
        if(pendingMode !== null)
        {
            pdfViewer.annotationEditorMode = { mode: EDITOR_TYPE[pendingMode] };
            pendingMode = null;
        }
        if(pendingParams !== null)
        {
            applyParams(pendingParams);
            pendingParams = null;
        }
    });

    eventBus.on('pagesinit', () =>
    {
        pagesReady = true;
        pdfViewer.currentScaleValue = pendingZoom ?? DEFAULT_ZOOM;
        pendingZoom = null;
        if(pendingRotation !== null) { pdfViewer.pagesRotation = pendingRotation; pendingRotation = null; }
        if(pendingPage !== null) { pdfViewer.currentPageNumber = pendingPage; pendingPage = null; }
        if(pendingFind !== null) { dispatchFind(pendingFind); pendingFind = null; }
        callbacks.onPage(pdfViewer.currentPageNumber, pdfViewer.pagesCount);
    });

    eventBus.on('pagechanging', (event : PageChangingEvent) =>
    {
        callbacks.onPage(event.pageNumber, pdfViewer.pagesCount);
    });

    // The find controller reports its running tally as it scans and its settled count when the walk lands. Both carry
    // the same { current, total } shape; either edge updates the toolbar's "x of y".
    eventBus.on('updatefindmatchescount', (event : FindMatchesEvent) =>
    {
        callbacks.onFind(event.matchesCount.current, event.matchesCount.total);
    });
    eventBus.on('updatefindcontrolstate', (event : FindMatchesEvent) =>
    {
        callbacks.onFind(event.matchesCount.current, event.matchesCount.total);
    });

    // pdf.js detaches the buffer it is handed to the worker; copy so the caller's bytes survive for a reload re-render.
    const loadingTask = getDocument({ data: data.slice() });
    const pdfDocument = await loadingTask.promise;

    // Unsaved marks are tracked by the document's annotation storage -- the same signal Mozilla's viewer builds its
    // save button on. It flips for editor annotations AND AcroForm field fills, i.e. exactly what saveDocument will
    // capture; save() resets it below so the next mark re-arms the modified edge. pdfjs-dist's .d.ts mis-types these
    // assignable hooks as bare `null` (the runtime and Mozilla's own viewer assign callbacks), hence the structural
    // cast.
    interface AnnotationStorageHooks
    {
        onSetModified : (() => void) | null;
        onResetModified : (() => void) | null;
    }

    const storageHooks = pdfDocument.annotationStorage as unknown as AnnotationStorageHooks;
    storageHooks.onSetModified = () => { callbacks.onDirty(true); };
    storageHooks.onResetModified = () => { callbacks.onDirty(false); };

    pdfViewer.setDocument(pdfDocument);
    linkService.setDocument(pdfDocument);

    return {
        setMode(mode : AnnotationMode) : void
        {
            // A read-only session never gets an editor manager -- mode requests are meaningless and stay no-ops.
            if(readOnly) { return; }
            if(!editorReady) { pendingMode = mode; return; }

            pdfViewer.annotationEditorMode = { mode: EDITOR_TYPE[mode] };
        },
        setZoom(value : string) : void
        {
            if(!pagesReady) { pendingZoom = value; return; }

            pdfViewer.currentScaleValue = value;
        },
        setRotation(degrees : number) : void
        {
            if(!pagesReady) { pendingRotation = degrees; return; }

            pdfViewer.pagesRotation = degrees;
        },
        setPage(page : number) : void
        {
            if(!pagesReady) { pendingPage = page; return; }

            pdfViewer.currentPageNumber = page;
        },
        setParams(params : EditorParams) : void
        {
            // Params only reach editors; a read-only session has none, so they stay no-ops like the mode does.
            if(readOnly) { return; }
            if(!editorReady) { pendingParams = params; return; }

            applyParams(params);
        },
        find(query : FindQuery) : void
        {
            if(!pagesReady) { pendingFind = query; return; }

            dispatchFind(query);
        },
        clearFind() : void
        {
            pendingFind = null;
            eventBus.dispatch('findbarclose', { source: pdfViewer });
        },
        async save() : Promise<Uint8Array>
        {
            const bytes = await pdfDocument.saveDocument();
            pdfDocument.annotationStorage.resetModified();

            return bytes;
        },
        destroy() : void
        {
            pdfViewer.cleanup();
            void loadingTask.destroy();
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
