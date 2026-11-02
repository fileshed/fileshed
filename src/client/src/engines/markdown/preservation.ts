//----------------------------------------------------------------------------------------------------------------------
// Markdown Preservation
//
// Preview writes markdown in its own spelling and drops syntax it doesn't show. An edit in Preview is the change from
// one of its serializations to the next; mergeEdit applies that change to the file rather than replacing the file, so
// whatever the edit didn't touch is written back byte for byte.
//----------------------------------------------------------------------------------------------------------------------

import { MARKDOWN_LINE_LIKENESS, MARKDOWN_MAX_LINE_PAIRS } from '@fileshed/core';
import { type ILCSResult, LCS, diff3Merge, diffIndices } from 'node-diff3';

//----------------------------------------------------------------------------------------------------------------------

export interface MarkdownEdit
{
    // The body as last written.
    file : string;

    // Preview's serialization of `file`.
    before : string;

    // Preview's serialization once the edit is made.
    after : string;

    // What Preview would write for some markdown. Two texts it writes alike mean the same document to Preview.
    normalize : (markdown : string) => string;
}

interface Span
{
    from : number;
    to : number;
}

interface EditWindow
{
    file : Span;
    before : Span;
    after : Span;
}

type Rewrite = (file : string[], before : string[], after : string[]) => string[];

//----------------------------------------------------------------------------------------------------------------------
// Rebasing
//----------------------------------------------------------------------------------------------------------------------

// Where an insertion between `before[start - 1]` and `before[start]` goes in the file: straight after the first's
// counterpart, or straight before the second's. Null when the side asked for has no counterpart and neither does the
// other.
function insertionPoint(map : number[], start : number, fileLength : number, preferNext : boolean) : number | null
{
    const previous = start === 0 ? -1 : map[start - 1] ?? -1;
    const next = start === map.length ? fileLength : map[start] ?? -1;
    const afterPrevious = start === 0 || previous >= 0 ? previous + 1 : null;
    const beforeNext = next >= 0 ? next : null;

    return preferNext ? beforeNext ?? afterPrevious : afterPrevious ?? beforeNext;
}

// Applies each hunk of the change from `before` to `after` at its counterpart in `file`, keeping whatever `file` has
// around those counterparts: content Preview never showed. `map` gives each element of `before` its counterpart in
// `file`, or -1; `rewrite` turns a hunk's counterparts into their edited form. Null when a hunk changes an element
// with no counterpart, since nothing then says where the change goes.
function rebase(
    file : string[],
    before : string[],
    after : string[],
    map : number[],
    rewrite : Rewrite,
    preferNext : boolean
) : string[] | null
{
    const placements : { positions : number[]; at : number; content : string[] }[] = [];

    for(const { buffer1: [ start, length ], buffer2Content } of diffIndices(before, after))
    {
        const positions = map.slice(start, start + length);
        if(positions.includes(-1)) { return null; }

        const at = positions[0] ?? insertionPoint(map, start, file.length, preferNext);
        if(at === null) { return null; }

        const counterparts = positions.map((position) => file[position] ?? '');
        const content = length === 0
            ? buffer2Content
            : rewrite(counterparts, before.slice(start, start + length), buffer2Content);

        placements.push({ positions, at, content });
    }

    // Last first, so each splice leaves the positions of the ones before it where they were.
    const out = [ ...file ];
    for(const { positions, at, content } of placements.reverse())
    {
        for(const position of [ ...positions ].reverse()) { out.splice(position, 1); }
        out.splice(at, 0, ...content);
    }

    return out;
}

//----------------------------------------------------------------------------------------------------------------------
// Words
//----------------------------------------------------------------------------------------------------------------------

// Words, whitespace runs, and single punctuation marks, so `__` and `**` differ in their own tokens and nowhere else.
const TOKEN = /[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]/gu;

function toTokens(lines : string[]) : string[]
{
    return lines.map((line) => `${ line }\n`).join('')
        .match(TOKEN) ?? [];
}

function fromTokens(tokens : string[]) : string[]
{
    const text = tokens.join('');

    return text === '' ? [] : text.replace(/\n$/u, '').split('\n');
}

// For each index of `from`, the index of the same element in `to`, or -1 where `to` has something else.
function alignExact(from : string[], to : string[]) : number[]
{
    const map = new Array<number>(from.length).fill(-1);
    for(let link : ILCSResult | null = LCS(from, to); link && link.buffer1index >= 0; link = link.chain)
    {
        map[link.buffer1index] = link.buffer2index;
    }

    return map;
}

// The edit of a few lines merged word by word into the file's spelling of them. Where the edit and that spelling
// change the same words, the edit is placed among the file's words if it can be, and takes them over if it can't.
function mergeWords(file : string[], before : string[], after : string[]) : string[]
{
    const merged = diff3Merge(toTokens(file), toTokens(before), toTokens(after)).flatMap((region) =>
    {
        if(region.ok) { return region.ok; }
        if(!region.conflict) { return []; }

        const { a: ours, o: base, b: edited } = region.conflict;
        return rebase(ours, base, edited, alignExact(base, ours), (_file, _before, hunk) => hunk, false) ?? edited;
    });

    return fromTokens(merged);
}

//----------------------------------------------------------------------------------------------------------------------
// Lines
//----------------------------------------------------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}]+/gu;

function countOf(keys : string[]) : Map<string, number>
{
    const counts = new Map<string, number>();
    keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));

    return counts;
}

// How alike two lines read by the words they share: 1 for the same line, 0 for no word in common. Lines without words
// (blank ones, `=====`, `---`) are alike only when they're the same.
function likeness(first : string, second : string) : number
{
    if(first === second) { return 1; }

    const firstWords = first.match(WORD) ?? [];
    const secondWords = second.match(WORD) ?? [];
    if(firstWords.length === 0 || secondWords.length === 0) { return 0; }

    const left = countOf(firstWords);
    let shared = 0;
    for(const word of secondWords)
    {
        const remaining = left.get(word) ?? 0;
        if(remaining > 0)
        {
            shared += 1;
            left.set(word, remaining - 1);
        }
    }

    return (2 * shared) / (firstWords.length + secondWords.length);
}

// For each line of `from`, the line of `to` that is the same line, perhaps spelled differently, or -1. The pairs keep
// their order and add up to the most likeness they can: a longest common subsequence where alike lines count as equal.
function alignLines(from : string[], to : string[]) : number[]
{
    if(from.length * to.length > MARKDOWN_MAX_LINE_PAIRS) { return alignExact(from, to); }

    const width = to.length + 1;
    const best = new Float64Array((from.length + 1) * width);
    const bestAt = (row : number, column : number) : number => best[(row * width) + column] ?? 0;
    const pairing = (row : number, column : number) : number | null =>
    {
        const like = likeness(from[row] ?? '', to[column] ?? '');

        return like >= MARKDOWN_LINE_LIKENESS ? like + bestAt(row + 1, column + 1) : null;
    };

    for(let row = from.length - 1; row >= 0; row--)
    {
        for(let column = to.length - 1; column >= 0; column--)
        {
            const skip = Math.max(bestAt(row + 1, column), bestAt(row, column + 1));
            best[(row * width) + column] = Math.max(skip, pairing(row, column) ?? 0);
        }
    }

    const map = new Array<number>(from.length).fill(-1);
    let row = 0;
    let column = 0;
    while(row < from.length && column < to.length)
    {
        if(pairing(row, column) === bestAt(row, column))
        {
            map[row] = column;
            row += 1;
            column += 1;
        }
        else if(bestAt(row + 1, column) >= bestAt(row, column + 1)) { row += 1; }
        else { column += 1; }
    }

    return map;
}

//----------------------------------------------------------------------------------------------------------------------
// Edit window
//----------------------------------------------------------------------------------------------------------------------

// A line's words without the markdown punctuation Preview spells its own way, so `__bold__` and `**bold**` lines match.
function looseKey(line : string) : string
{
    return (line.match(WORD) ?? []).join(' ');
}

// Only the lines between the nearest line on each side of the edit whose words occur once in both texts get compared:
// those lines pin where the window sits in the file. Comparing whole files instead costs time quadratic in their
// length on every keystroke.
function findWindow(file : string[], before : string[], after : string[]) : EditWindow
{
    let prefix = 0;
    while(prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) { prefix += 1; }

    let suffix = 0;
    const room = Math.min(before.length, after.length) - prefix;
    while(suffix < room && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) { suffix += 1; }

    const fileKeys = file.map(looseKey);
    const beforeKeys = before.map(looseKey);
    const fileCounts = countOf(fileKeys);
    const beforeCounts = countOf(beforeKeys);
    const isAnchor = (key : string | undefined) : boolean =>
    {
        return key !== undefined && key !== '' && fileCounts.get(key) === 1 && beforeCounts.get(key) === 1;
    };

    let start = prefix - 1;
    while(start >= 0 && !isAnchor(beforeKeys[start])) { start -= 1; }

    let end = before.length - suffix;
    while(end < before.length && !isAnchor(beforeKeys[end])) { end += 1; }

    const fileStart = start < 0 ? 0 : fileKeys.indexOf(beforeKeys[start] ?? '') + 1;
    const fileEnd = end >= before.length ? file.length : fileKeys.indexOf(beforeKeys[end] ?? '');
    if(fileStart > fileEnd)
    {
        return {
            file: { from: 0, to: file.length },
            before: { from: 0, to: before.length },
            after: { from: 0, to: after.length },
        };
    }

    return {
        file: { from: fileStart, to: fileEnd },
        before: { from: start + 1, to: end },
        after: { from: start + 1, to: after.length - (before.length - end) },
    };
}

//----------------------------------------------------------------------------------------------------------------------

// Link reference definitions (`[ref]: https://…`), which a window's `[text][ref]` links need to mean anything.
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S/u;

// A merge is kept only when its window means what Preview shows there. A new line can go on either side of hidden
// content (an underlined heading's `=====` belongs above it, a comment introducing a paragraph below), so both are
// tried; when neither reads right, the window takes Preview's text. Only the window is checked: parsing the whole file
// on every keystroke is too slow for long files.
export function mergeEdit(edit : MarkdownEdit) : string
{
    const { file, before, after, normalize } = edit;
    if(before === after) { return file; }
    if(file === before) { return after; }

    const fileLines = file.split('\n');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const window = findWindow(fileLines, beforeLines, afterLines);
    const fileSlice = fileLines.slice(window.file.from, window.file.to);
    const beforeSlice = beforeLines.slice(window.before.from, window.before.to);
    const afterSlice = afterLines.slice(window.after.from, window.after.to);
    const assemble = (middle : string[]) : string =>
    {
        return [ ...fileLines.slice(0, window.file.from), ...middle, ...fileLines.slice(window.file.to) ].join('\n');
    };

    // Nothing in the window is spelled differently, so the edit is all that changes there.
    if(fileSlice.join('\n') === beforeSlice.join('\n')) { return assemble(afterSlice); }

    // Each side is read between its own anchor lines, since an anchor can lean on the window for its meaning (an
    // underlined heading's text line above its `=====`). The definitions from outside the window go past the end anchor
    // (or ahead of the start one), so hidden content inside the window can't shift the blank lines around them.
    const outside = fileLines.filter((line, index) =>
    {
        return (index < window.file.from || index >= window.file.to) && DEFINITION.test(line);
    });
    const spacer = outside.length > 0 ? [ '' ] : [];
    const meaning = (middle : string[], startLine : string | undefined, endLine : string | undefined) : string =>
    {
        const head = startLine === undefined ? [] : [ startLine ];
        const lines = endLine === undefined
            ? [ ...outside, ...spacer, ...head, ...middle ]
            : [ ...head, ...middle, endLine, ...spacer, ...outside ];

        return normalize(lines.join('\n'));
    };
    const target = meaning(afterSlice, afterLines[window.after.from - 1], afterLines[window.after.to]);

    const map = alignLines(beforeSlice, fileSlice);
    const candidates = new Map<string, string[]>();
    for(const preferNext of [ true, false ])
    {
        const merged = rebase(fileSlice, beforeSlice, afterSlice, map, mergeWords, preferNext);
        if(merged) { candidates.set(merged.join('\n'), merged); }
    }

    const startLine = fileLines[window.file.from - 1];
    const endLine = fileLines[window.file.to];
    const kept = [ ...candidates.values() ].find((merged) => meaning(merged, startLine, endLine) === target);

    return assemble(kept ?? afterSlice);
}

//----------------------------------------------------------------------------------------------------------------------
