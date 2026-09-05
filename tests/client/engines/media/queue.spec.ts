//----------------------------------------------------------------------------------------------------------------------
// Media Queue Engine — playlist zipper surgery
//
// The contract: only concrete files with audio/* or video/* mimes become tracks; the queue is a zipper whose current
// track always exists (empty is null, not a hollow queue); next/previous stop at the boundaries rather than wrap;
// selection jumps anywhere in range; removal promotes the successor (or, at the tail, the predecessor) and empties
// the playlist only when the last track goes. Out-of-range surgery hands the queue back untouched.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { NodeResponse } from '@fileshed/core';

// Engines
import {
    type MediaQueue,
    type MediaTrack,
    appendTrack,
    currentIndexOf,
    moveEntry,
    nextTrack,
    previousTrack,
    queueFromTrack,
    removeAt,
    selectAt,
    trackForPlay,
    trackFromNode,
    tracksOf,
    withEntryFailed,
} from '@client/engines/media/queue.ts';

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function fileNode(overrides : Partial<{ id : string; name : string; mimeType : string }> = {}) : NodeResponse
{
    return {
        sharing: null,
        id: overrides.id ?? 'f1',
        name: overrides.name ?? 'song.mp3',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: overrides.mimeType ?? 'audio/mpeg',
        trashedAt: null,
    };
}

function linkNode() : NodeResponse
{
    return {
        sharing: null,
        id: 'l1',
        name: 'shared-movie',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'viewer',
        type: 'link',
        targetNodeID: 'f9',
        target: { id: 'f9', type: 'file', name: 'movie.mp4', ownerID: 'u2', mimeType: 'video/mp4', size: 99 },
    };
}

function track(id : string, kind : 'audio' | 'video' = 'audio') : MediaTrack
{
    return {
        entryID: `seat-${ id }`,
        nodeID: id,
        name: `${ id }.media`,
        mimeType: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
        kind,
        remoteUrl: null,
        broken: false,
        failed: false,
    };
}

function queueOf(before : string[], current : string, after : string[]) : MediaQueue
{
    return { before: before.map((id) => track(id)), current: track(current), after: after.map((id) => track(id)) };
}

function ids(queue : MediaQueue) : string[]
{
    return tracksOf(queue).map((entry) => entry.nodeID);
}

//----------------------------------------------------------------------------------------------------------------------

describe('trackFromNode', () =>
{
    it('turns an audio file into an audio track carrying its identity and mime', () =>
    {
        const node = fileNode({ id: 'a1', name: 'song.mp3', mimeType: 'audio/mpeg' });

        expect(trackFromNode(node)).toEqual({
            entryID: expect.any(String),
            nodeID: 'a1',
            name: 'song.mp3',
            mimeType: 'audio/mpeg',
            kind: 'audio',
            remoteUrl: null,
            broken: false,
            failed: false,
        });
    });

    it('turns a video file into a video track', () =>
    {
        const node = fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' });

        expect(trackFromNode(node)?.kind).toBe('video');
    });

    it('refuses a file whose mime is not media', () =>
    {
        expect(trackFromNode(fileNode({ mimeType: 'text/plain' }))).toBeNull();
    });

    it('refuses a link even when its target is media — only concrete files join the queue', () =>
    {
        expect(trackFromNode(linkNode())).toBeNull();
    });
});

describe('trackForPlay', () =>
{
    it('carries a file node\'s own mime and takes the kind from the resolved intent', () =>
    {
        const node = fileNode({ id: 'v1', name: 'clip.mp4', mimeType: 'video/mp4' });

        expect(trackForPlay(node, 'video')).toEqual({
            entryID: expect.any(String),
            nodeID: 'v1',
            name: 'clip.mp4',
            mimeType: 'video/mp4',
            kind: 'video',
            remoteUrl: null,
            broken: false,
            failed: false,
        });
    });

    it('plays a link\'s target -- the target\'s id and mime -- under the link\'s own display name', () =>
    {
        const played = trackForPlay(linkNode(), 'video');

        expect(played).toEqual({
            entryID: expect.any(String),
            nodeID: 'f9',
            name: 'shared-movie',
            mimeType: 'video/mp4',
            kind: 'video',
            remoteUrl: null,
            broken: false,
            failed: false,
        });
    });

    it('leaves the mime unknown when the link target carries none, so the browser sniffs instead of refusing', () =>
    {
        const node = linkNode();
        if(node.type === 'link' && node.target !== null) { delete node.target.mimeType; }

        expect(trackForPlay(node, 'audio').mimeType).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('queueFromTrack', () =>
{
    it('builds a single-track queue with that track current at index zero', () =>
    {
        const queue = queueFromTrack(track('a'));

        expect(ids(queue)).toEqual([ 'a' ]);
        expect(currentIndexOf(queue)).toBe(0);
        expect(queue.current.nodeID).toBe('a');
    });
});

describe('appendTrack', () =>
{
    it('adds to the end of the queue without moving the current track', () =>
    {
        const queue = appendTrack(queueOf([ 'a' ], 'b', []), track('c'));

        expect(ids(queue)).toEqual([ 'a', 'b', 'c' ]);
        expect(queue.current.nodeID).toBe('b');
        expect(currentIndexOf(queue)).toBe(1);
    });
});

describe('nextTrack', () =>
{
    it('advances to the following track, preserving queue order', () =>
    {
        const queue = nextTrack(queueOf([ 'a' ], 'b', [ 'c', 'd' ]));

        expect(queue).not.toBeNull();
        expect(queue !== null && queue.current.nodeID).toBe('c');
        expect(queue !== null && ids(queue)).toEqual([ 'a', 'b', 'c', 'd' ]);
        expect(queue !== null && currentIndexOf(queue)).toBe(2);
    });

    it('returns null at the last track — the queue does not wrap', () =>
    {
        expect(nextTrack(queueOf([ 'a', 'b' ], 'c', []))).toBeNull();
    });
});

describe('previousTrack', () =>
{
    it('steps back to the preceding track, preserving queue order', () =>
    {
        const queue = previousTrack(queueOf([ 'a', 'b' ], 'c', [ 'd' ]));

        expect(queue).not.toBeNull();
        expect(queue !== null && queue.current.nodeID).toBe('b');
        expect(queue !== null && ids(queue)).toEqual([ 'a', 'b', 'c', 'd' ]);
        expect(queue !== null && currentIndexOf(queue)).toBe(1);
    });

    it('returns null at the first track', () =>
    {
        expect(previousTrack(queueOf([], 'a', [ 'b' ]))).toBeNull();
    });
});

describe('selectAt', () =>
{
    it('jumps forward to the chosen row', () =>
    {
        const queue = selectAt(queueOf([], 'a', [ 'b', 'c' ]), 2);

        expect(queue.current.nodeID).toBe('c');
        expect(ids(queue)).toEqual([ 'a', 'b', 'c' ]);
        expect(currentIndexOf(queue)).toBe(2);
    });

    it('jumps backward to the chosen row', () =>
    {
        const queue = selectAt(queueOf([ 'a', 'b' ], 'c', []), 0);

        expect(queue.current.nodeID).toBe('a');
        expect(currentIndexOf(queue)).toBe(0);
    });

    it('hands back the queue unchanged for the already-current row', () =>
    {
        const queue = queueOf([ 'a' ], 'b', [ 'c' ]);

        expect(selectAt(queue, 1)).toBe(queue);
    });

    it('hands back the queue unchanged for an out-of-range row', () =>
    {
        const queue = queueOf([ 'a' ], 'b', [ 'c' ]);

        expect(selectAt(queue, 3)).toBe(queue);
        expect(selectAt(queue, -1)).toBe(queue);
    });
});

describe('removeAt', () =>
{
    it('removes a track before the current one, keeping the same track current', () =>
    {
        const queue = removeAt(queueOf([ 'a', 'b' ], 'c', [ 'd' ]), 0);

        expect(queue).not.toBeNull();
        expect(queue !== null && queue.current.nodeID).toBe('c');
        expect(queue !== null && ids(queue)).toEqual([ 'b', 'c', 'd' ]);
        expect(queue !== null && currentIndexOf(queue)).toBe(1);
    });

    it('removes a track after the current one without touching the current position', () =>
    {
        const queue = removeAt(queueOf([ 'a' ], 'b', [ 'c', 'd' ]), 2);

        expect(queue !== null && queue.current.nodeID).toBe('b');
        expect(queue !== null && ids(queue)).toEqual([ 'a', 'b', 'd' ]);
        expect(queue !== null && currentIndexOf(queue)).toBe(1);
    });

    it('promotes the successor when the current track is removed mid-queue', () =>
    {
        const queue = removeAt(queueOf([ 'a' ], 'b', [ 'c', 'd' ]), 1);

        expect(queue !== null && queue.current.nodeID).toBe('c');
        expect(queue !== null && ids(queue)).toEqual([ 'a', 'c', 'd' ]);
        expect(queue !== null && currentIndexOf(queue)).toBe(1);
    });

    it('falls back to the predecessor when the current track is removed at the tail', () =>
    {
        const queue = removeAt(queueOf([ 'a', 'b' ], 'c', []), 2);

        expect(queue !== null && queue.current.nodeID).toBe('b');
        expect(queue !== null && ids(queue)).toEqual([ 'a', 'b' ]);
        expect(queue !== null && currentIndexOf(queue)).toBe(1);
    });

    it('empties the playlist when the only track is removed', () =>
    {
        expect(removeAt(queueOf([], 'a', []), 0)).toBeNull();
    });

    it('hands back the queue unchanged for an out-of-range row', () =>
    {
        const queue = queueOf([ 'a' ], 'b', []);

        expect(removeAt(queue, 5)).toBe(queue);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('entry identity', () =>
{
    it('gives the same file a distinct seat every time it joins the queue', () =>
    {
        const node = fileNode({ id: 'dup' });

        const first = trackFromNode(node);
        const second = trackFromNode(node);

        expect(first?.nodeID).toBe(second?.nodeID);
        expect(first?.entryID).not.toBe(second?.entryID);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('moveEntry', () =>
{
    it('reorders a seat without changing what is playing', () =>
    {
        const queue = queueOf([ 'a' ], 'b', [ 'c', 'd' ]);

        const moved = moveEntry(queue, 3, 0);

        expect(ids(moved)).toEqual([ 'd', 'a', 'b', 'c' ]);
        expect(moved.current.nodeID).toBe('b');
        expect(currentIndexOf(moved)).toBe(2);
    });

    it('lets the current seat itself travel, staying current at its new position', () =>
    {
        const queue = queueOf([ 'a' ], 'b', [ 'c' ]);

        const moved = moveEntry(queue, 1, 2);

        expect(ids(moved)).toEqual([ 'a', 'c', 'b' ]);
        expect(moved.current.nodeID).toBe('b');
        expect(currentIndexOf(moved)).toBe(2);
    });

    it('hands back the queue unchanged for out-of-range or same-place moves', () =>
    {
        const queue = queueOf([ 'a' ], 'b', [ 'c' ]);

        expect(moveEntry(queue, 0, 9)).toBe(queue);
        expect(moveEntry(queue, 9, 0)).toBe(queue);
        expect(moveEntry(queue, 1, 1)).toBe(queue);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('withEntryFailed', () =>
{
    it('marks exactly the named seat, wherever it sits in the zipper', () =>
    {
        const queue = queueOf([ 'a' ], 'b', [ 'c' ]);

        const marked = withEntryFailed(queue, 'seat-c', true);

        expect(tracksOf(marked).map((entry) => entry.failed)).toEqual([ false, false, true ]);
        expect(withEntryFailed(marked, 'seat-c', false).after[0]?.failed).toBe(false);
    });

    it('hands back an equivalent queue for an unknown seat', () =>
    {
        const queue = queueOf([], 'a', [ 'b' ]);

        expect(tracksOf(withEntryFailed(queue, 'seat-nope', true)).every((entry) => !entry.failed)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
