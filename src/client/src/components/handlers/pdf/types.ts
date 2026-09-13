//----------------------------------------------------------------------------------------------------------------------
// PDF Annotator Types
//
// The handler family's own vocabulary, kept free of pdf.js so the store and toolbar can speak it without pulling the
// renderer in. The binding maps these onto pdf.js's AnnotationEditorType / AnnotationEditorParamsType / scale strings /
// find events at the boundary.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------

// The annotation tools the surface exposes. `none` is the plain reading/selecting mode; the rest arm one of pdf.js's
// annotation editors. pdf.js cannot edit existing page content, so these add marks over the page -- they never rewrite
// what is already there.
//
// pdf.js also ships signature and comment editors. Both are driven by manager objects that exist only inside Mozilla's
// own viewer application, which is not distributed in the npm package, so arming either here would hand the editor a
// null manager and open nothing.
export const annotationModes = [ 'none', 'freetext', 'ink', 'highlight', 'stamp' ] as const;

export type AnnotationMode = typeof annotationModes[number];

//----------------------------------------------------------------------------------------------------------------------
// Zoom
//----------------------------------------------------------------------------------------------------------------------

// A zoom choice the toolbar offers. `value` is handed to pdf.js as a scale: the named values track the container
// (`auto`, `page-width`, `page-fit`), the numeric strings are absolute scales.
export interface ZoomPreset
{
    label : string;
    value : string;
}

export const zoomPresets : ZoomPreset[]
    = [
        { label: 'Automatic', value: 'auto' },
        { label: 'Fit width', value: 'page-width' },
        { label: 'Fit page', value: 'page-fit' },
        { label: '50%', value: '0.5' },
        { label: '75%', value: '0.75' },
        { label: '100%', value: '1' },
        { label: '125%', value: '1.25' },
        { label: '150%', value: '1.5' },
        { label: '200%', value: '2' },
    ];

// The absolute-scale rungs the +/- step buttons walk. A step from a named preset (auto / fit) starts at 100%, since
// only pdf.js knows a fit mode's true scale and the store deliberately does not import it.
export const zoomLadder : string[] = [ '0.5', '0.75', '1', '1.25', '1.5', '2' ];

export const DEFAULT_ZOOM = 'auto';

//----------------------------------------------------------------------------------------------------------------------
// Rotation
//----------------------------------------------------------------------------------------------------------------------

// Absolute page rotation in degrees, normalized to one of the four right angles. A quarter turn is 90; the store keeps
// the normalized value so a full loop lands back on 0.
export const ROTATION_STEP = 90;

//----------------------------------------------------------------------------------------------------------------------
// Annotation editor parameters
//----------------------------------------------------------------------------------------------------------------------

// A named swatch offered in a params popover.
export interface ColorSwatch
{
    name : string;
    value : string;
}

// Mozilla's default highlight palette, so a FileShed highlight reads the same as one made in Firefox's viewer.
export const highlightColors : ColorSwatch[]
    = [
        { name: 'Yellow', value: '#FFFF98' },
        { name: 'Green', value: '#53FFBC' },
        { name: 'Blue', value: '#80EBFF' },
        { name: 'Pink', value: '#FFCBE6' },
        { name: 'Red', value: '#FF4F5F' },
    ];

// A general ink/text palette: a black default plus saturated primaries.
export const drawColors : ColorSwatch[]
    = [
        { name: 'Black', value: '#000000' },
        { name: 'Red', value: '#E4463F' },
        { name: 'Blue', value: '#2E7CF6' },
        { name: 'Green', value: '#199B4C' },
        { name: 'Yellow', value: '#EFB800' },
    ];

// A slider's bounds. Opacity and font size are the toolbar's own units (percent, points); the binding rescales opacity
// to pdf.js's 0..1 at the boundary.
export interface ParamRange
{
    min : number;
    max : number;
    step : number;
}

export const highlightThicknessRange : ParamRange = { min: 8, max: 24, step: 1 };
export const textSizeRange : ParamRange = { min: 5, max: 100, step: 1 };
export const inkThicknessRange : ParamRange = { min: 1, max: 20, step: 1 };
export const inkOpacityRange : ParamRange = { min: 1, max: 100, step: 1 };

export interface HighlightParams
{
    color : string;
    thickness : number;
    showAll : boolean;
}

export interface TextParams
{
    color : string;
    size : number;
}

export interface InkParams
{
    color : string;
    thickness : number;
    opacity : number;
}

export interface EditorParams
{
    highlight : HighlightParams;
    text : TextParams;
    ink : InkParams;
}

// A fresh copy of the defaults, matching pdf.js's own editor defaults (yellow highlight, 12pt thickness; black text at
// 10pt; black ink, full opacity). A factory, not a shared constant, so a reset can't alias a previous session's object.
export function defaultEditorParams() : EditorParams
{
    return {
        highlight: { color: '#FFFF98', thickness: 12, showAll: true },
        text: { color: '#000000', size: 10 },
        ink: { color: '#000000', thickness: 3, opacity: 100 },
    };
}

//----------------------------------------------------------------------------------------------------------------------
// Find
//----------------------------------------------------------------------------------------------------------------------

// One search dispatched at the renderer. `again` distinguishes a fresh query from a repeat over the same term (the
// next/prev walk), and `findPrevious` picks the walk's direction.
export interface FindQuery
{
    query : string;
    caseSensitive : boolean;
    entireWord : boolean;
    matchDiacritics : boolean;
    highlightAll : boolean;
    findPrevious : boolean;
    again : boolean;
}

// The find toggles a reader can set, held apart from a dispatched query so the find bar binds to one object and every
// toggle re-runs the current term through the same builder.
export interface FindOptions
{
    caseSensitive : boolean;
    entireWord : boolean;
    matchDiacritics : boolean;
    highlightAll : boolean;
}

export function defaultFindOptions() : FindOptions
{
    return { caseSensitive: false, entireWord: false, matchDiacritics: false, highlightAll: true };
}

//----------------------------------------------------------------------------------------------------------------------
// Cursor tool
//----------------------------------------------------------------------------------------------------------------------

// What a drag on the page does. `select` leaves the text layer to handle it, which is how text is selected and copied;
// `pan` drags the scroll position instead, for a reader zoomed in past the viewport.
export const cursorTools = [ 'select', 'pan' ] as const;

export type CursorTool = typeof cursorTools[number];

//----------------------------------------------------------------------------------------------------------------------
// Layout
//----------------------------------------------------------------------------------------------------------------------

// How pages are laid out in the scroll container, and whether they pair up as facing pages. Both are pdf.js's own
// vocabulary named in words rather than its numeric enums, which the binding maps at the boundary.
export const scrollModes = [ 'vertical', 'horizontal', 'wrapped', 'page' ] as const;

export type ScrollModeName = typeof scrollModes[number];

export const spreadModes = [ 'none', 'odd', 'even' ] as const;

export type SpreadModeName = typeof spreadModes[number];

//----------------------------------------------------------------------------------------------------------------------
// Sidebar
//----------------------------------------------------------------------------------------------------------------------

export const sidebarTabs = [ 'thumbnails', 'outline', 'attachments' ] as const;

export type SidebarTab = typeof sidebarTabs[number];

export const THUMBNAIL_WIDTH = 96;

// A destination inside the document, as pdf.js hands it back: either a named destination or an explicit array. It is
// carried opaquely -- only the renderer can resolve one, and nothing outside the binding reads into it.
export type OutlineDestination = string | unknown[];

// One entry in the document outline. `id` is assigned by the binding while flattening pdf.js's nested reply, since
// outline entries carry no identity of their own and Vue needs a stable key. An entry with no destination is a
// heading: it expands, but clicking it navigates nowhere.
export interface OutlineEntry
{
    id : string;
    title : string;
    bold : boolean;
    italic : boolean;
    dest : OutlineDestination | null;
    items : OutlineEntry[];
}

// An embedded file. The format records no length for one, and pdf.js reads the bytes only when asked, so the list
// carries what the document actually states and nothing more; `id` is what the renderer wants back to fetch it.
export interface PdfAttachment
{
    id : string;
    filename : string;
    description : string;
}

//----------------------------------------------------------------------------------------------------------------------
// Document properties
//----------------------------------------------------------------------------------------------------------------------

// What the properties dialog shows. Every field is optional in a PDF, so each is either a string to print or null,
// already formatted by the binding -- the dialog renders, it does not interpret.
export interface DocumentProperties
{
    title : string | null;
    author : string | null;
    subject : string | null;
    keywords : string | null;
    creator : string | null;
    producer : string | null;
    creationDate : string | null;
    modificationDate : string | null;
    version : string | null;
    pageCount : number;
    pageSize : string | null;
    linearized : boolean;
}

//----------------------------------------------------------------------------------------------------------------------
// Alt text
//----------------------------------------------------------------------------------------------------------------------

// An image annotation asking to be described. pdf.js draws the button and hands the question over; `apply` is how the
// answer gets back to the annotation that asked, and a dialog closed without applying leaves the description alone.
export interface AltTextRequest
{
    altText : string;
    decorative : boolean;
    apply : (altText : string, decorative : boolean) => void;
}

//----------------------------------------------------------------------------------------------------------------------
// Editor history
//----------------------------------------------------------------------------------------------------------------------

// Whether the annotation editor has anything to undo or redo. Reported by the renderer as marks are made and stepped
// through; the toolbar only enables its controls, it never guesses.
export interface EditorHistory
{
    canUndo : boolean;
    canRedo : boolean;
}

//----------------------------------------------------------------------------------------------------------------------
