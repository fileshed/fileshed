//----------------------------------------------------------------------------------------------------------------------
// PDF Document Facts
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { OutlineDestination, OutlineEntry } from './types.ts';

//----------------------------------------------------------------------------------------------------------------------

// pdf.js's outline reply, which its .d.ts describes only loosely. Only the fields rendered are named.
export interface RawOutlineEntry
{
    title : string;
    bold : boolean;
    italic : boolean;
    dest : OutlineDestination | null;
    items : RawOutlineEntry[];
}

//----------------------------------------------------------------------------------------------------------------------
// Page size
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

export function namePageSize(width : number, height : number) : string | null
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

export function describePageSize(width : number, height : number) : string
{
    const inches = (value : number) : string => (Math.round((value / POINTS_PER_INCH) * 100) / 100).toString();
    const mm = (value : number) : string => Math.round((value / POINTS_PER_INCH) * MM_PER_INCH).toString();

    const measured = `${ inches(width) } × ${ inches(height) } in (${ mm(width) } × ${ mm(height) } mm)`;
    const named = namePageSize(width, height);

    return named === null ? measured : `${ measured } — ${ named }`;
}

//----------------------------------------------------------------------------------------------------------------------
// Info dictionary and outline
//----------------------------------------------------------------------------------------------------------------------

// A blank value in a PDF's info dictionary means the same thing as an absent one: nothing to print.
export function textOrNull(raw : string | undefined) : string | null
{
    const trimmed = raw?.trim() ?? '';

    return trimmed === '' ? null : trimmed;
}

function adoptBranch(entries : RawOutlineEntry[], prefix : string) : OutlineEntry[]
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
            items: adoptBranch(entry.items ?? [], `${ id }.`),
        };
    });
}

// Outline entries carry no identity of their own, so one is assigned by position while the nested reply is walked --
// stable for as long as the document is open, which is as long as anything keys on it.
export function adoptOutline(entries : RawOutlineEntry[]) : OutlineEntry[]
{
    return adoptBranch(entries, '');
}

//----------------------------------------------------------------------------------------------------------------------
