//----------------------------------------------------------------------------------------------------------------------
// Byte Serving
//
// Only a single byte range is honoured; anything else falls back to the full body, which RFC 7233 permits.
//----------------------------------------------------------------------------------------------------------------------

export interface ByteWindow
{
    offset : number;
    length : number;
}

export type RangePlan
    = | { kind : 'full' }
    | { kind : 'partial'; window : ByteWindow }
    | { kind : 'unsatisfiable' };

//----------------------------------------------------------------------------------------------------------------------

// A single satisfiable range yields a window; an out-of-bounds range is unsatisfiable (416); everything else -- no
// header, a non-bytes unit, a multi-range set, or a malformed spec -- is the full body (200).
export function parseRange(header : string | undefined, size : number) : RangePlan
{
    if(header === undefined) { return { kind: 'full' }; }

    const unit = /^bytes=(.+)$/.exec(header.trim());
    if(unit === null) { return { kind: 'full' }; }

    // Multiple comma-separated ranges are not served as multipart/byteranges here; a single range is enough,
    // so the whole body is returned instead -- always a valid response to any range request.
    const spec = (unit[1] ?? '').trim();
    if(spec.includes(',')) { return { kind: 'full' }; }

    const bounds = /^(\d*)-(\d*)$/.exec(spec);
    if(bounds === null) { return { kind: 'full' }; }

    const startText = bounds[1] ?? '';
    const endText = bounds[2] ?? '';

    // "bytes=-N": the final N bytes. A zero-width window -- N == 0, or any suffix against an empty blob -- names no
    // bytes at all, so there is nothing satisfiable to return.
    if(startText === '')
    {
        if(endText === '') { return { kind: 'full' }; }

        const length = Math.min(Number(endText), size);
        if(length === 0) { return { kind: 'unsatisfiable' }; }

        return { kind: 'partial', window: { offset: size - length, length } };
    }

    const start = Number(startText);
    if(start >= size) { return { kind: 'unsatisfiable' }; }

    // A last-byte-pos below first-byte-pos makes the byte-range-spec INVALID rather than unsatisfiable, and RFC 7233
    // §2.1 says an invalid spec is ignored -- so the full body is served. 416 is reserved for a syntactically valid
    // range that simply falls outside the blob (first-byte-pos >= length, caught above).
    const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
    if(end < start) { return { kind: 'full' }; }

    return { kind: 'partial', window: { offset: start, length: (end - start) + 1 } };
}

// A strong ETag over the blob's content hash, which is what the blob id already is.
export function strongEtag(sha256 : string) : string
{
    return `"${ sha256 }"`;
}

// Whether If-None-Match matches the current representation. `*` matches anything; otherwise each listed entry
// is compared to the sha256 after stripping an optional weak (`W/`) marker and the surrounding quotes.
export function ifNoneMatchHits(header : string | undefined, sha256 : string) : boolean
{
    if(header === undefined) { return false; }

    const value = header.trim();
    if(value === '*') { return true; }

    return value.split(',').some((raw) =>
    {
        let tag = raw.trim();
        if(tag.startsWith('W/')) { tag = tag.slice(2).trim(); }
        if(tag.startsWith('"') && tag.endsWith('"')) { tag = tag.slice(1, -1); }
        return tag === sha256;
    });
}

//----------------------------------------------------------------------------------------------------------------------
