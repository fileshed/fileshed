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
export const annotationModes = [ 'none', 'freetext', 'ink', 'highlight' ] as const;

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

export const DEFAULT_ZOOM = 'page-width';

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
    highlightAll : boolean;
    findPrevious : boolean;
    again : boolean;
}

//----------------------------------------------------------------------------------------------------------------------
