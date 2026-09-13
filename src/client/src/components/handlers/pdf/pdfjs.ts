//----------------------------------------------------------------------------------------------------------------------
// pdf.js Binding
//
// The one place anything touches pdf.js: the surface drives PDFs through a small, house-shaped API and the rest of the
// family (store, toolbar, sidebar, tests) never imports the renderer.
//
// It is built on pdfjs-dist's viewer *components* (PDFViewer + EventBus + PDFLinkService + PDFFindController), not the
// prebuilt Mozilla viewer application, which the npm package does not ship at all. PDFViewer already does the hard
// parts correctly and version-stably -- lazy page rendering, the selectable text layer, the find controller wired to
// the text layer, and the AnnotationEditorLayer wired to a shared editor UI manager. What the components bundle leaves
// out is the chrome: the sidebar, the thumbnails, the outline, the document properties. Those are assembled here out of
// the document APIs, which are stable and documented, rather than reached for inside Mozilla's application.
//
// pdf.js cannot edit existing page content. The annotation editors add marks OVER the page (free text, ink, highlight,
// stamp); saveDocument serializes those, plus any AcroForm field values, as an incremental update to the original
// bytes -- a real, valid PDF, not a re-render. The worker is bundled (Vite ?url import), never fetched from a CDN, so a
// self-hosted deployment carries its own renderer.
//----------------------------------------------------------------------------------------------------------------------

import {
    AnnotationEditorParamsType,
    AnnotationEditorType,
    GlobalWorkerOptions,
    PDFDateString,
    getDocument,
} from 'pdfjs-dist';
import {
    EventBus,
    PDFFindController,
    PDFLinkService,
    PDFViewer,
    ScrollMode,
    SpreadMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Components
import {
    type AltTextRequest,
    type AnnotationMode,
    DEFAULT_ZOOM,
    type DocumentProperties,
    type EditorParams,
    type FindQuery,
    type OutlineDestination,
    type OutlineEntry,
    type PdfAttachment,
    type ScrollModeName,
    type SpreadModeName,
    highlightColors,
} from './types.ts';

//----------------------------------------------------------------------------------------------------------------------

// The worker ships with the app; set once at module load, before any getDocument call.
GlobalWorkerOptions.workerSrc = workerSrc;

const EDITOR_TYPE : Record<AnnotationMode, number>
    = {
        none: AnnotationEditorType.NONE,
        freetext: AnnotationEditorType.FREETEXT,
        ink: AnnotationEditorType.INK,
        highlight: AnnotationEditorType.HIGHLIGHT,
        stamp: AnnotationEditorType.STAMP,
    };

const SCROLL_MODE : Record<ScrollModeName, number>
    = {
        vertical: ScrollMode.VERTICAL,
        horizontal: ScrollMode.HORIZONTAL,
        wrapped: ScrollMode.WRAPPED,
        page: ScrollMode.PAGE,
    };

const SPREAD_MODE : Record<SpreadModeName, number>
    = {
        none: SpreadMode.NONE,
        odd: SpreadMode.ODD,
        even: SpreadMode.EVEN,
    };

// A highlight annotation carries its own colour control on the toolbar that appears when it is selected, and pdf.js
// builds that control only when it was handed a palette:
//
//     get toolbarButtons() { if(this._uiManager.highlightColors) { ...colorPicker... } return super.toolbarButtons; }
//
// Handed nothing, the toolbar silently falls back to a delete button alone and a highlight can never be recoloured
// after it is drawn. pdf.js parses the list itself, as comma-separated name=#hex pairs, so the swatches the params
// popover offers are reused here rather than a second palette being written down beside them.
const HIGHLIGHT_PALETTE = highlightColors
    .map(({ name, value }) => `${ name.toLowerCase() }=${ value }`)
    .join(',');

//----------------------------------------------------------------------------------------------------------------------

export interface PdfSessionCallbacks
{
    onPage : (current : number, total : number) => void;
    onDirty : (dirty : boolean) => void;
    onFind : (current : number, total : number) => void;
    onEditorHistory : (canUndo : boolean, canRedo : boolean) => void;
    onAltText : (request : AltTextRequest) => void;
}

export interface PdfSession
{
    // Read once when the document opens; none of the three changes while it is open.
    outline : OutlineEntry[];
    attachments : PdfAttachment[];
    properties : DocumentProperties;

    setMode : (mode : AnnotationMode) => void;
    setZoom : (value : string) => void;
    setRotation : (degrees : number) => void;
    setPage : (page : number) => void;
    setScrollMode : (mode : ScrollModeName) => void;
    setSpreadMode : (mode : SpreadModeName) => void;
    setParams : (params : EditorParams) => void;
    goToDestination : (dest : OutlineDestination) => void;
    renderThumbnail : (page : number, canvas : HTMLCanvasElement, width : number) => Promise<void>;
    readAttachment : (id : string) => Promise<Uint8Array | null>;
    addImage : () => void;
    undo : () => void;
    redo : () => void;
    serialize : () => Promise<Uint8Array>;
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
// Untyped boundaries
//----------------------------------------------------------------------------------------------------------------------

// Payload shapes read off the event bus. pdf.js does not type its bus events, so the reads it exposes are narrowed here
// to just the fields consumed.
interface PageChangingEvent { pageNumber : number; }
interface FindMatchesEvent { matchesCount : { current : number; total : number }; }
interface EditorUIManagerEvent { uiManager : { undo : () => void; redo : () => void } | null; }
interface EditingStatesEvent { details : { hasSomethingToUndo ?: boolean; hasSomethingToRedo ?: boolean }; }

// pdf.js's outline reply, which its .d.ts describes only loosely. Only the fields rendered are named.
interface RawOutlineEntry
{
    title : string;
    bold : boolean;
    italic : boolean;
    dest : OutlineDestination | null;
    items : RawOutlineEntry[];
}

interface RawAttachment { filename : string; rawFilename : string; description : string; }

// The half of an annotation editor an alt-text dialog touches. pdf.js hands the editor over untyped.
interface AltTextData { altText : string | null; decorative : boolean; }
interface AltTextEditor { altTextData : AltTextData | undefined; }

// pdfjs-dist's .d.ts leaves altTextManager off PDFViewerOptions, though PDFViewer reads it straight off the options
// object at runtime (`this.#altTextManager = options.altTextManager || null`). Naming it here keeps everything else in
// the options type-checked rather than casting the whole literal away.
type ViewerOptions = ConstructorParameters<typeof PDFViewer>[0] & { altTextManager : unknown };

// getMetadata's `info` is a bag whose keys are all optional; these are the ones the properties dialog prints.
interface RawDocumentInfo
{
    Title ?: string;
    Author ?: string;
    Subject ?: string;
    Keywords ?: string;
    Creator ?: string;
    Producer ?: string;
    CreationDate ?: string;
    ModDate ?: string;
    PDFFormatVersion ?: string;
    IsLinearized ?: boolean;
}

//----------------------------------------------------------------------------------------------------------------------
// Document facts
//----------------------------------------------------------------------------------------------------------------------

// Named page sizes, in PDF points, matched within a point either way -- a generator's rounding should not cost a
// document its name. Landscape is the same paper, so both orientations match.
const PAGE_SIZES : readonly { name : string; width : number; height : number }[]
    = [
        { name: 'Letter', width: 612, height: 792 },
        { name: 'Legal', width: 612, height: 1008 },
        { name: 'Tabloid', width: 792, height: 1224 },
        { name: 'A3', width: 842, height: 1191 },
        { name: 'A4', width: 595, height: 842 },
        { name: 'A5', width: 420, height: 595 },
    ];

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

function namePageSize(width : number, height : number) : string | null
{
    const match = PAGE_SIZES.find((size) =>
    {
        const upright = Math.abs(size.width - width) <= 1 && Math.abs(size.height - height) <= 1;
        const landscape = Math.abs(size.height - width) <= 1 && Math.abs(size.width - height) <= 1;

        return upright || landscape;
    });

    if(match === undefined) { return null; }

    return width > height ? `${ match.name }, landscape` : match.name;
}

function describePageSize(width : number, height : number) : string
{
    const inches = (value : number) : string => (Math.round((value / POINTS_PER_INCH) * 100) / 100).toString();
    const mm = (value : number) : string => Math.round((value / POINTS_PER_INCH) * MM_PER_INCH).toString();

    const measured = `${ inches(width) } × ${ inches(height) } in (${ mm(width) } × ${ mm(height) } mm)`;
    const named = namePageSize(width, height);

    return named === null ? measured : `${ measured } — ${ named }`;
}

function formatDate(raw : string | undefined) : string | null
{
    if(raw === undefined) { return null; }

    const parsed = PDFDateString.toDateObject(raw);

    return parsed === null ? null : parsed.toLocaleString();
}

// A blank value in a PDF's info dictionary means the same thing as an absent one: nothing to print.
function textOrNull(raw : string | undefined) : string | null
{
    const trimmed = raw?.trim() ?? '';

    return trimmed === '' ? null : trimmed;
}

// Read one fact about the document, or settle for not knowing it. Every one of these is optional in the format and
// pdf.js rejects rather than returning nothing when it cannot make sense of what it finds -- an outline it will not
// parse, a damaged info dictionary. None of that is a reason to refuse to render the pages, which is the job.
async function attempt<T>(read : () => Promise<T>, fallback : T) : Promise<T>
{
    try { return await read(); }
    catch { return fallback; }
}

// Outline entries carry no identity of their own, so one is assigned by position while the nested reply is walked --
// stable for as long as the document is open, which is as long as anything keys on it.
function adoptOutline(entries : RawOutlineEntry[], prefix : string) : OutlineEntry[]
{
    return entries.map((entry, index) =>
    {
        const id = `${ prefix }${ index }`;

        return {
            id,
            title: entry.title.trim(),
            bold: entry.bold,
            italic: entry.italic,
            dest: entry.dest,
            items: adoptOutline(entry.items ?? [], `${ id }.`),
        };
    });
}

//----------------------------------------------------------------------------------------------------------------------

export async function openPdfSession(options : PdfSessionOptions) : Promise<PdfSession>
{
    const { container, viewer, data, readOnly, callbacks } = options;

    // pdf.js draws the "add a description" button on an image annotation itself, then asks a manager to run the dialog
    // behind it: `this.#altTextManager?.editAltText(...)`, which is a silent no-op when no manager was supplied -- a
    // button on screen that does nothing at all. The manager's whole contract is this one call and a teardown, and the
    // answer travels back on the editor's own altTextData, so the dialog itself is ours to show.
    const altTextManager = {
        editAltText(_manager : unknown, editor : AltTextEditor) : void
        {
            const current = editor.altTextData;

            callbacks.onAltText({
                altText: current?.altText ?? '',
                decorative: current?.decorative ?? false,
                apply: (altText : string, decorative : boolean) : void =>
                {
                    editor.altTextData = { altText, decorative };
                },
            });
        },
        destroy() : void
        {
            // Nothing is held open between dialogs: the request carries its own way back to the annotation.
        },
    };

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
        annotationEditorHighlightColors: HIGHLIGHT_PALETTE,
        altTextManager,
    } as ViewerOptions);
    linkService.setViewer(pdfViewer);

    // The viewer initializes asynchronously after setDocument: the annotation editor's UI manager and the page layout
    // each arrive on their own bus events, and assigning a mode, editor params, a scale, a rotation, a page, a layout
    // mode, or a search before then throws or lands nowhere. Requests that arrive early are parked and applied the
    // moment the viewer says that layer is ready.
    let editorReady = false;
    let uiManager : EditorUIManagerEvent['uiManager'] = null;
    let pendingMode : AnnotationMode | null = null;
    let pendingParams : EditorParams | null = null;

    let pagesReady = false;
    let pendingZoom : string | null = null;
    let pendingRotation : number | null = null;
    let pendingPage : number | null = null;
    let pendingScroll : ScrollModeName | null = null;
    let pendingSpread : SpreadModeName | null = null;
    let pendingFind : FindQuery | null = null;
    let pendingDest : OutlineDestination | null = null;

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
            entireWord: query.entireWord,
            highlightAll: query.highlightAll,
            findPrevious: query.findPrevious,
            matchDiacritics: query.matchDiacritics,
        });
    }

    eventBus.on('annotationeditoruimanager', (event : EditorUIManagerEvent) =>
    {
        editorReady = true;
        uiManager = event.uiManager;

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

    eventBus.on('editingstateschanged', (event : EditingStatesEvent) =>
    {
        callbacks.onEditorHistory(event.details.hasSomethingToUndo ?? false, event.details.hasSomethingToRedo ?? false);
    });

    eventBus.on('pagesinit', () =>
    {
        pagesReady = true;
        pdfViewer.currentScaleValue = pendingZoom ?? DEFAULT_ZOOM;
        pendingZoom = null;
        if(pendingScroll !== null) { pdfViewer.scrollMode = SCROLL_MODE[pendingScroll]; pendingScroll = null; }
        if(pendingSpread !== null) { pdfViewer.spreadMode = SPREAD_MODE[pendingSpread]; pendingSpread = null; }
        if(pendingRotation !== null) { pdfViewer.pagesRotation = pendingRotation; pendingRotation = null; }
        if(pendingPage !== null) { pdfViewer.currentPageNumber = pendingPage; pendingPage = null; }
        if(pendingDest !== null) { linkService.goToDestination(pendingDest); pendingDest = null; }
        if(pendingFind !== null) { dispatchFind(pendingFind); pendingFind = null; }
        callbacks.onPage(pdfViewer.currentPageNumber, pdfViewer.pagesCount);
    });

    eventBus.on('pagechanging', (event : PageChangingEvent) =>
    {
        callbacks.onPage(event.pageNumber, pdfViewer.pagesCount);
    });

    // pdf.js recomputes a fit scale when the WINDOW resizes and at no other time, so a container that changes width on
    // its own -- the sidebar opening, the layout settling in the frames after mount -- leaves the page drawn to a width
    // it no longer has. Re-stating the current scale is what re-fits it; for an absolute scale it changes nothing.
    //
    // Only a real width change re-fits. Re-fitting can add or remove the scrollbar, which changes the container's
    // client width right back, and reacting to that would oscillate.
    let fittedWidth = 0;

    const resizeObserver = new ResizeObserver(() =>
    {
        if(!pagesReady || container.clientWidth === 0 || container.clientWidth === fittedWidth) { return; }

        fittedWidth = container.clientWidth;

        const scale : string | undefined = pdfViewer.currentScaleValue;
        if(scale !== undefined) { pdfViewer.currentScaleValue = scale; }
    });

    resizeObserver.observe(container);

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

    //------------------------------------------------------------------------------------------------------------------
    // Document facts, read once
    //------------------------------------------------------------------------------------------------------------------

    const rawOutline = await attempt<RawOutlineEntry[] | null>(() => pdfDocument.getOutline(), null);
    const outline = adoptOutline(rawOutline ?? [], '');

    const rawAttachments = await attempt<Map<string, RawAttachment> | null>(
        () => pdfDocument.getAttachments() as Promise<Map<string, RawAttachment> | null>,
        null
    );
    const attachments : PdfAttachment[] = [ ...(rawAttachments ?? new Map<string, RawAttachment>()) ]
        .map(([ id, entry ]) => ({ id, filename: entry.filename, description: entry.description }));

    const info = await attempt<RawDocumentInfo>(
        async () => (await pdfDocument.getMetadata()).info as RawDocumentInfo,
        {}
    );
    const pageSize = await attempt<string | null>(async () =>
    {
        const firstPage = await pdfDocument.getPage(1);
        const viewport = firstPage.getViewport({ scale: 1, rotation: 0 });

        return describePageSize(viewport.width, viewport.height);
    }, null);

    const properties : DocumentProperties = {
        title: textOrNull(info.Title),
        author: textOrNull(info.Author),
        subject: textOrNull(info.Subject),
        keywords: textOrNull(info.Keywords),
        creator: textOrNull(info.Creator),
        producer: textOrNull(info.Producer),
        creationDate: formatDate(info.CreationDate),
        modificationDate: formatDate(info.ModDate),
        version: textOrNull(info.PDFFormatVersion),
        pageCount: pdfDocument.numPages,
        pageSize,
        linearized: info.IsLinearized === true,
    };

    //------------------------------------------------------------------------------------------------------------------

    return {
        outline,
        attachments,
        properties,

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
        setScrollMode(mode : ScrollModeName) : void
        {
            if(!pagesReady) { pendingScroll = mode; return; }

            pdfViewer.scrollMode = SCROLL_MODE[mode];
        },
        setSpreadMode(mode : SpreadModeName) : void
        {
            if(!pagesReady) { pendingSpread = mode; return; }

            pdfViewer.spreadMode = SPREAD_MODE[mode];
        },
        setParams(params : EditorParams) : void
        {
            // Params only reach editors; a read-only session has none, so they stay no-ops like the mode does.
            if(readOnly) { return; }
            if(!editorReady) { pendingParams = params; return; }

            applyParams(params);
        },
        goToDestination(dest : OutlineDestination) : void
        {
            if(!pagesReady) { pendingDest = dest; return; }

            void linkService.goToDestination(dest);
        },

        // Rasterize one page into a caller-owned canvas at a fixed width, matching the viewer's current rotation so a
        // rotated document's thumbnails turn with it. The canvas is sized to the device's pixel ratio and scaled back
        // down in CSS, so a thumbnail is sharp on a retina display rather than doubled and blurry.
        async renderThumbnail(page : number, canvas : HTMLCanvasElement, width : number) : Promise<void>
        {
            const context = canvas.getContext('2d');
            if(context === null) { return; }

            const rotation = pagesReady ? pdfViewer.pagesRotation : 0;
            const pageProxy = await pdfDocument.getPage(page);
            const base = pageProxy.getViewport({ scale: 1, rotation });
            const viewport = pageProxy.getViewport({ scale: width / base.width, rotation });
            const ratio = window.devicePixelRatio || 1;

            canvas.width = Math.ceil(viewport.width * ratio);
            canvas.height = Math.ceil(viewport.height * ratio);
            canvas.style.width = `${ Math.ceil(viewport.width) }px`;
            canvas.style.height = `${ Math.ceil(viewport.height) }px`;
            context.scale(ratio, ratio);

            await pageProxy.render({ canvas, canvasContext: context, viewport }).promise;
        },
        // pdf.js reads an embedded file only when it is asked to, so this is where the bytes are actually fetched.
        async readAttachment(id : string) : Promise<Uint8Array | null>
        {
            return attempt<Uint8Array | null>(() => pdfDocument.getAttachmentContent(id), null);
        },
        // A click on the page never makes a stamp. pdf.js's editor layer returns early for STAMP (and for popup and
        // signature) before it would create an editor, so an image can only arrive by asking for the editor outright:
        // `isFromKeyboard` is that request, and the stamp editor opens the file picker itself once it exists.
        //
        // The mode is cleared first because updateMode returns immediately when the mode is already what it is being
        // set to -- without that, a second image could only be added by switching to another tool and back.
        addImage() : void
        {
            if(readOnly) { return; }
            if(!editorReady) { pendingMode = 'stamp'; return; }

            pdfViewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
            pdfViewer.annotationEditorMode = { mode: AnnotationEditorType.STAMP, isFromKeyboard: true };
        },
        undo() : void
        {
            uiManager?.undo();
        },
        redo() : void
        {
            uiManager?.redo();
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
        // The annotated document as bytes, leaving the unsaved-marks flag exactly where it was. Printing and saving
        // both want these bytes; only saving has earned the right to say the marks are no longer unsaved.
        async serialize() : Promise<Uint8Array>
        {
            return pdfDocument.saveDocument();
        },
        async save() : Promise<Uint8Array>
        {
            const bytes = await pdfDocument.saveDocument();
            pdfDocument.annotationStorage.resetModified();

            return bytes;
        },
        destroy() : void
        {
            resizeObserver.disconnect();
            pdfViewer.cleanup();
            void loadingTask.destroy();
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
