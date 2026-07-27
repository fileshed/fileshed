//----------------------------------------------------------------------------------------------------------------------
// Media Queue Engine
//
// Pure track shaping and queue surgery behind the media player's playlist. The queue is a zipper -- the tracks
// before the current one, the current track, and the tracks after it -- so a non-empty queue always has a valid
// current track by construction; there is no index to fall out of range. An empty playlist is `null`, not a queue
// with nothing in it.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export type MediaKind = 'audio' | 'video';

// What happens when a track ends: play on and stop at the queue's tail, wrap back around, or stay on this track.
export type RepeatMode = 'off' | 'all' | 'one';

export interface MediaTrack
{
    // The track's stable identity within the queue: a drive node's id -- or, for a remote stream, the URL itself,
    // and for an unresolvable playlist entry, a synthetic broken key. Everything keyed per track (tags, the shuffle
    // played-set, row removal) hangs off this.
    nodeID : string;

    name : string;

    // null means unknown -- the source element then omits its type attribute so the browser sniffs the bytes,
    // rather than refusing a type it doesn't recognize without ever fetching them.
    mimeType : string | null;

    kind : MediaKind;

    // A remote stream's URL; the drive serves everything else.
    remoteUrl : string | null;

    // A playlist entry whose file couldn't be resolved: rendered dimmed, skipped when playback reaches it.
    broken : boolean;
}

export interface MediaQueue
{
    before : MediaTrack[];
    current : MediaTrack;
    after : MediaTrack[];
}

//----------------------------------------------------------------------------------------------------------------------
// Track shaping
//----------------------------------------------------------------------------------------------------------------------

// A playlist addition: only concrete files with a media mime become tracks; anything else has no seat in the queue.
export function trackFromNode(node : NodeResponse) : MediaTrack | null
{
    if(node.type !== 'file') { return null; }

    let kind : MediaKind | null = null;
    if(node.mimeType.startsWith('audio/')) { kind = 'audio'; }
    else if(node.mimeType.startsWith('video/')) { kind = 'video'; }

    if(kind === null) { return null; }

    return { nodeID: node.id, name: node.name, mimeType: node.mimeType, kind, remoteUrl: null, broken: false };
}

// The track a resolved play action opens with. The kind is the intent registry's verdict, not re-derived here. A
// link plays its TARGET -- the target's id is what the download endpoint streams -- under the link's own display
// name; a target mime the resolution didn't carry stays unknown.
export function trackForPlay(node : NodeResponse, kind : MediaKind) : MediaTrack
{
    if(node.type === 'link' && node.target !== null)
    {
        return {
            nodeID: node.target.id,
            name: node.name,
            mimeType: node.target.mimeType ?? null,
            kind,
            remoteUrl: null,
            broken: false,
        };
    }

    const mimeType = node.type === 'file' ? node.mimeType : null;

    return { nodeID: node.id, name: node.name, mimeType, kind, remoteUrl: null, broken: false };
}

const REMOTE_VIDEO_EXTENSIONS = [ '.mp4', '.m4v', '.webm', '.mkv', '.mov', '.avi' ] as const;

// A remote stream from a playlist: the URL is the identity, the last path segment the display name, and the kind a
// guess from the extension -- audio unless it looks like video, since audio playlists are what people actually pass
// around.
export function trackFromUrl(url : string) : MediaTrack
{
    let name = url;

    try
    {
        const segments = new URL(url).pathname.split('/').filter((segment) => segment.length > 0);
        name = decodeURIComponent(segments.at(-1) ?? url);
    }
    catch { /* an unparseable URL keeps itself as the display name */ }

    const lower = name.toLowerCase();
    const kind = REMOTE_VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? 'video' : 'audio';

    return { nodeID: url, name, mimeType: null, kind, remoteUrl: url, broken: false };
}

// The visible stand-in for a playlist entry that resolved to nothing: it keeps the row (and the user's knowledge
// that something is missing) without anything to play.
export function brokenTrack(label : string, key : string) : MediaTrack
{
    return { nodeID: `broken:${ key }`, name: label, mimeType: null, kind: 'audio', remoteUrl: null, broken: true };
}

//----------------------------------------------------------------------------------------------------------------------
// Queue surgery -- every function returns a new queue; none mutate their argument.
//----------------------------------------------------------------------------------------------------------------------

export function queueFromTrack(track : MediaTrack) : MediaQueue
{
    return { before: [], current: track, after: [] };
}

export function appendTrack(queue : MediaQueue, track : MediaTrack) : MediaQueue
{
    return { ...queue, after: [ ...queue.after, track ] };
}

export function tracksOf(queue : MediaQueue) : MediaTrack[]
{
    return [ ...queue.before, queue.current, ...queue.after ];
}

export function currentIndexOf(queue : MediaQueue) : number
{
    return queue.before.length;
}

// Null at the last track -- the queue does not wrap; playback stops at the end like a file, not a radio.
export function nextTrack(queue : MediaQueue) : MediaQueue | null
{
    const [ next, ...rest ] = queue.after;
    if(next === undefined) { return null; }

    return { before: [ ...queue.before, queue.current ], current: next, after: rest };
}

export function previousTrack(queue : MediaQueue) : MediaQueue | null
{
    const previous = queue.before[queue.before.length - 1];
    if(previous === undefined) { return null; }

    return { before: queue.before.slice(0, -1), current: previous, after: [ queue.current, ...queue.after ] };
}

// A jump to any row. Out of range -- or the row that is already current -- hands back the queue unchanged.
export function selectAt(queue : MediaQueue, index : number) : MediaQueue
{
    const tracks = tracksOf(queue);
    const target = tracks[index];

    if(target === undefined || index === currentIndexOf(queue)) { return queue; }

    return { before: tracks.slice(0, index), current: target, after: tracks.slice(index + 1) };
}

// The rows shuffle may jump to next: every position other than the current one whose file hasn't played this
// shuffle cycle. Duplicate files share played-ness -- a song heard once counts as heard. Empty means the cycle is
// exhausted; the caller decides whether that stops playback or starts a fresh cycle.
export function unplayedIndexes(queue : MediaQueue, playedIDs : ReadonlySet<string>) : number[]
{
    const current = currentIndexOf(queue);

    return tracksOf(queue)
        .map((track, index) => ({ track, index }))
        .filter(({ track, index }) => index !== current && !playedIDs.has(track.nodeID))
        .map(({ index }) => index);
}

// Removing the current track promotes its successor (or, at the end of the queue, its predecessor); removing the
// only track empties the playlist. Out of range hands back the queue unchanged.
export function removeAt(queue : MediaQueue, index : number) : MediaQueue | null
{
    const tracks = tracksOf(queue);
    const currentIndex = currentIndexOf(queue);

    if(tracks[index] === undefined) { return queue; }
    if(tracks.length === 1) { return null; }

    const remaining = [ ...tracks.slice(0, index), ...tracks.slice(index + 1) ];
    const nextCurrentIndex = index < currentIndex ? currentIndex - 1 : Math.min(currentIndex, remaining.length - 1);
    const current = remaining[nextCurrentIndex];

    if(current === undefined) { return queue; }

    return { before: remaining.slice(0, nextCurrentIndex), current, after: remaining.slice(nextCurrentIndex + 1) };
}

//----------------------------------------------------------------------------------------------------------------------
