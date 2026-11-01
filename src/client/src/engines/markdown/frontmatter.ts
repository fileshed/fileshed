//----------------------------------------------------------------------------------------------------------------------
// Markdown Frontmatter
//
// A file opens with frontmatter when its first line is exactly `---` and a later line closes it the same way, the rule
// Jekyll, gray-matter and remark use. The content between the fences isn't checked: a blank first line or YAML that
// doesn't parse still counts, so a typo can't turn the block into body text that an edit rewrites. A file that opens
// with a `---` divider and has another `---` line later reads as frontmatter.
//
// The split is lossless (fence + gap + body is always the whole file), so whichever part a write leaves alone goes
// back byte for byte. The one blank line conventionally left after the closing fence is the gap, so a body never
// opens on it.
//----------------------------------------------------------------------------------------------------------------------

export interface Frontmatter
{
    // The text between the fences, verbatim.
    yaml : string;

    // Everything from the opening `---` through the closing fence and its line terminator.
    fence : string;

    // The blank line after the closing fence, or '' when the body starts directly under it.
    gap : string;
}

export interface MarkdownSplit
{
    frontmatter : Frontmatter | null;
    body : string;
}

//----------------------------------------------------------------------------------------------------------------------

const OPEN_FENCE = /^---[ \t]*\r?\n/u;
const CLOSE_FENCE = /^---[ \t]*(?:\r?\n|$)/mu;
const BLANK_LINE = /^\r?\n/u;

function terminated(text : string) : string
{
    return text.endsWith('\n') ? text : `${ text }\n`;
}

//----------------------------------------------------------------------------------------------------------------------

export function splitFrontmatter(text : string) : MarkdownSplit
{
    const open = OPEN_FENCE.exec(text);
    if(!open) { return { frontmatter: null, body: text }; }

    const rest = text.slice(open[0].length);
    const close = CLOSE_FENCE.exec(rest);
    if(!close) { return { frontmatter: null, body: text }; }

    const fenceEnd = open[0].length + close.index + close[0].length;
    const after = text.slice(fenceEnd);
    const gap = close[0].endsWith('\n') ? (BLANK_LINE.exec(after)?.[0] ?? '') : '';

    return {
        frontmatter: { yaml: rest.slice(0, close.index), fence: text.slice(0, fenceEnd), gap },
        body: after.slice(gap.length),
    };
}

// An empty body has no separator to keep, so text typed under bare frontmatter gets the conventional blank line.
export function replaceBody(text : string, body : string) : string
{
    const { frontmatter, body: current } = splitFrontmatter(text);
    if(frontmatter === null) { return body; }
    if(current === '' && body !== '') { return `${ terminated(frontmatter.fence) }\n${ body }`; }

    return `${ frontmatter.fence }${ frontmatter.gap }${ body }`;
}

// Blank YAML removes the block. A new block gets the conventional blank line before a body; a replaced one keeps the
// separation it had.
export function replaceFrontmatter(text : string, yaml : string) : string
{
    const { frontmatter, body } = splitFrontmatter(text);
    if(yaml.trim() === '') { return body; }

    const gap = body === '' ? '' : (frontmatter?.gap ?? '\n');

    return `---\n${ terminated(yaml) }---\n${ gap }${ body }`;
}

//----------------------------------------------------------------------------------------------------------------------
