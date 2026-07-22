//----------------------------------------------------------------------------------------------------------------------
// Selection Engine
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { NodeResponse } from '@fileshed/core';

import {
    applyClick,
    canCopySelection,
    clearSelection,
    emptySelection,
    planTrash,
    reconcile,
} from '@client/engines/selection.ts';

//----------------------------------------------------------------------------------------------------------------------
// Selection Model
//----------------------------------------------------------------------------------------------------------------------

const ORDER = [ 'a', 'b', 'c', 'd', 'e' ];

const PLAIN = { toggle: false, range: false };
const TOGGLE = { toggle: true, range: false };
const RANGE = { toggle: false, range: true };

function ids(selected : ReadonlySet<string>) : string[]
{
    return [ ...selected ].sort();
}

//----------------------------------------------------------------------------------------------------------------------

describe('emptySelection', () =>
{
    it('starts with nothing selected and no anchor', () =>
    {
        const state = emptySelection();

        expect(state.selected.size).toBe(0);
        expect(state.anchor).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('applyClick — plain click', () =>
{
    it('selects only the clicked node and makes it the anchor', () =>
    {
        const state = applyClick(emptySelection(), ORDER, 'c', PLAIN);

        expect(ids(state.selected)).toEqual([ 'c' ]);
        expect(state.anchor).toBe('c');
    });

    it('replaces an existing multi-selection with the single clicked node', () =>
    {
        const many = { selected: new Set([ 'a', 'b', 'c' ]), anchor: 'a' };

        const state = applyClick(many, ORDER, 'e', PLAIN);

        expect(ids(state.selected)).toEqual([ 'e' ]);
        expect(state.anchor).toBe('e');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('applyClick — cmd/ctrl toggle', () =>
{
    it('adds an unselected node to the selection and moves the anchor to it', () =>
    {
        const start = applyClick(emptySelection(), ORDER, 'b', PLAIN);

        const state = applyClick(start, ORDER, 'd', TOGGLE);

        expect(ids(state.selected)).toEqual([ 'b', 'd' ]);
        expect(state.anchor).toBe('d');
    });

    it('removes an already-selected node, leaving the rest', () =>
    {
        const start = { selected: new Set([ 'b', 'd' ]), anchor: 'd' };

        const state = applyClick(start, ORDER, 'd', TOGGLE);

        expect(ids(state.selected)).toEqual([ 'b' ]);
        expect(state.anchor).toBe('d');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('applyClick — shift range', () =>
{
    it('selects the inclusive range from the anchor forward', () =>
    {
        const anchored = applyClick(emptySelection(), ORDER, 'b', PLAIN);

        const state = applyClick(anchored, ORDER, 'd', RANGE);

        expect(ids(state.selected)).toEqual([ 'b', 'c', 'd' ]);
        expect(state.anchor).toBe('b');
    });

    it('selects the inclusive range when the click is above the anchor', () =>
    {
        const anchored = applyClick(emptySelection(), ORDER, 'd', PLAIN);

        const state = applyClick(anchored, ORDER, 'b', RANGE);

        expect(ids(state.selected)).toEqual([ 'b', 'c', 'd' ]);
        expect(state.anchor).toBe('d');
    });

    it('re-ranges from the same anchor on a second shift-click, replacing the first range', () =>
    {
        const anchored = applyClick(emptySelection(), ORDER, 'b', PLAIN);
        const firstRange = applyClick(anchored, ORDER, 'd', RANGE);

        const state = applyClick(firstRange, ORDER, 'a', RANGE);

        expect(ids(state.selected)).toEqual([ 'a', 'b' ]);
        expect(state.anchor).toBe('b');
    });

    it('ranges from an anchor a toggle click established', () =>
    {
        const toggled = applyClick(emptySelection(), ORDER, 'c', TOGGLE);

        const state = applyClick(toggled, ORDER, 'e', RANGE);

        expect(ids(state.selected)).toEqual([ 'c', 'd', 'e' ]);
        expect(state.anchor).toBe('c');
    });

    it('degrades to a single select when there is no anchor', () =>
    {
        const state = applyClick(emptySelection(), ORDER, 'c', RANGE);

        expect(ids(state.selected)).toEqual([ 'c' ]);
        expect(state.anchor).toBe('c');
    });

    it('degrades to a single select when the anchor has left the view', () =>
    {
        const stale = { selected: new Set([ 'z' ]), anchor: 'z' };

        const state = applyClick(stale, ORDER, 'c', RANGE);

        expect(ids(state.selected)).toEqual([ 'c' ]);
        expect(state.anchor).toBe('c');
    });

    it('takes the range branch when both range and toggle modifiers are held', () =>
    {
        const anchored = applyClick(emptySelection(), ORDER, 'a', PLAIN);

        const state = applyClick(anchored, ORDER, 'c', { toggle: true, range: true });

        expect(ids(state.selected)).toEqual([ 'a', 'b', 'c' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('clearSelection', () =>
{
    it('empties the selection and forgets the anchor', () =>
    {
        const state = clearSelection();

        expect(state.selected.size).toBe(0);
        expect(state.anchor).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('reconcile', () =>
{
    it('drops ids that are no longer present', () =>
    {
        const start = { selected: new Set([ 'a', 'b', 'c' ]), anchor: 'b' };

        const state = reconcile(start, [ 'a', 'c' ]);

        expect(ids(state.selected)).toEqual([ 'a', 'c' ]);
    });

    it('clears a dangling anchor whose node has gone', () =>
    {
        const start = { selected: new Set([ 'a' ]), anchor: 'b' };

        const state = reconcile(start, [ 'a' ]);

        expect(state.anchor).toBeNull();
    });

    it('keeps the anchor when its node is still present', () =>
    {
        const start = { selected: new Set([ 'a', 'b' ]), anchor: 'b' };

        const state = reconcile(start, [ 'a', 'b' ]);

        expect(state.anchor).toBe('b');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Selection Actions
//----------------------------------------------------------------------------------------------------------------------

const BASE = {
    name: 'thing',
    ownerID: 'u1',
    parentID: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    role: 'owner' as const,
};

function file(id : string) : NodeResponse
{
    return { ...BASE, id, type: 'file', blobID: 'b1', size: 10, mimeType: 'text/plain', trashedAt: null };
}

function folder(id : string) : NodeResponse
{
    return { ...BASE, id, type: 'folder', trashedAt: null };
}

function link(id : string) : NodeResponse
{
    return { ...BASE, id, type: 'link', targetNodeID: 't1', target: { id: 't1', type: 'file', name: 'x' } };
}

//----------------------------------------------------------------------------------------------------------------------

describe('canCopySelection', () =>
{
    it('enables copy when every selected node is a file', () =>
    {
        expect(canCopySelection([ file('a'), file('b') ])).toBe(true);
    });

    it('disables copy when a folder is in the selection', () =>
    {
        expect(canCopySelection([ file('a'), folder('b') ])).toBe(false);
    });

    it('disables copy when a link is in the selection', () =>
    {
        expect(canCopySelection([ file('a'), link('b') ])).toBe(false);
    });

    it('disables copy for an empty selection', () =>
    {
        expect(canCopySelection([])).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('planTrash', () =>
{
    it('trashes a selection of only files and folders, skipping no links', () =>
    {
        const plan = planTrash([ file('a'), folder('b') ]);

        expect(plan.mode).toBe('trash');
        expect(plan.targetIDs).toEqual([ 'a', 'b' ]);
        expect(plan.skippedLinks).toBe(0);
    });

    it('removes a links-only selection', () =>
    {
        const plan = planTrash([ link('a'), link('b') ]);

        expect(plan.mode).toBe('remove');
        expect(plan.targetIDs).toEqual([ 'a', 'b' ]);
        expect(plan.skippedLinks).toBe(0);
    });

    it('trashes the files and folders of a mixed selection and reports the links left behind', () =>
    {
        const plan = planTrash([ file('a'), link('b'), folder('c'), link('d') ]);

        expect(plan.mode).toBe('trash');
        expect(plan.targetIDs).toEqual([ 'a', 'c' ]);
        expect(plan.skippedLinks).toBe(2);
    });

    it('removes a single selected link', () =>
    {
        expect(planTrash([ link('a') ])).toEqual({ mode: 'remove', targetIDs: [ 'a' ], skippedLinks: 0 });
    });
});

//----------------------------------------------------------------------------------------------------------------------
