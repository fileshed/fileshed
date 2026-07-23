//----------------------------------------------------------------------------------------------------------------------
// Selection Engine
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { NodeResponse } from '@fileshed/core';

import {
    applyClick,
    canCopyNode,
    canCopySelection,
    canShareNode,
    clearSelection,
    emptySelection,
    isOwnedBy,
    ownsSelection,
    planTrash,
    reconcile,
} from '@client/engines/intent/selection.ts';

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

type Overrides = Partial<Pick<NodeResponse, 'ownerID' | 'role'>>;

function file(id : string, overrides : Overrides = {}) : NodeResponse
{
    return { ...BASE, id, type: 'file', blobID: 'b1', size: 10, mimeType: 'text/plain', trashedAt: null, ...overrides };
}

function folder(id : string, overrides : Overrides = {}) : NodeResponse
{
    return { ...BASE, id, type: 'folder', trashedAt: null, ...overrides };
}

function link(id : string, overrides : Overrides = {}) : NodeResponse
{
    return {
        ...BASE,
        id,
        type: 'link',
        targetNodeID: 't1',
        target: { id: 't1', type: 'file', name: 'x', ownerID: 'u1' },
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('canCopyNode', () =>
{
    it('admits a file', () =>
    {
        expect(canCopyNode(file('a'))).toBe(true);
    });

    it('refuses a folder -- no single blob to reference', () =>
    {
        expect(canCopyNode(folder('a'))).toBe(false);
    });

    it('refuses a link -- an inert pointer with no bytes of its own', () =>
    {
        expect(canCopyNode(link('a'))).toBe(false);
    });

    it('admits a file regardless of role -- copy asks only read access', () =>
    {
        expect(canCopyNode(file('a', { role: 'viewer' }))).toBe(true);
        expect(canCopyNode(file('a', { role: 'editor' }))).toBe(true);
    });
});

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
// Ownership-Gated Actions
//
// Share, Rename, Move, and Trash/Remove administer a node and the server admits each only from direct ownership
// (node.ownerID), never the resolved `role` -- a folder owner reads a contribution placed in their own folder as
// role 'owner' by inheritance, without administering it. Every case below is built with role deliberately set OPPOSITE
// of what ownerID would suggest, to prove the admission never takes the role shortcut.
//----------------------------------------------------------------------------------------------------------------------

describe('isOwnedBy', () =>
{
    it('admits the direct owner', () =>
    {
        expect(isOwnedBy(file('a', { ownerID: 'me' }), 'me')).toBe(true);
    });

    it('refuses a node owned by someone else', () =>
    {
        expect(isOwnedBy(file('a', { ownerID: 'someone-else' }), 'me')).toBe(false);
    });

    it('refuses a null caller (no signed-in user to own anything)', () =>
    {
        expect(isOwnedBy(file('a', { ownerID: 'me' }), null)).toBe(false);
    });

    it('refuses a node whose resolved role is owner but whose direct owner is someone else', () =>
    {
        // A folder owner's role over a contribution placed inside their own folder resolves to 'owner' by
        // inheritance; ownerID still names the contributor. Administering it is still refused.
        const contribution = file('a', { ownerID: 'contributor', role: 'owner' });

        expect(isOwnedBy(contribution, 'folder-owner')).toBe(false);
    });

    it('admits a directly owned node even when its resolved role reads editor or viewer', () =>
    {
        // Unreachable in practice (direct ownership always resolves at least 'owner'), but the admission must key off
        // ownerID alone, so a role field that disagrees changes nothing.
        expect(isOwnedBy(file('a', { ownerID: 'me', role: 'viewer' }), 'me')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('canShareNode', () =>
{
    it('admits the direct owner of a file', () =>
    {
        expect(canShareNode(file('a', { ownerID: 'me' }), 'me')).toBe(true);
    });

    it('admits the direct owner of a folder', () =>
    {
        expect(canShareNode(folder('a', { ownerID: 'me' }), 'me')).toBe(true);
    });

    it('refuses a link even when owned -- a link carries no ACL of its own', () =>
    {
        expect(canShareNode(link('a', { ownerID: 'me' }), 'me')).toBe(false);
    });

    it('refuses a file the caller does not directly own', () =>
    {
        expect(canShareNode(file('a', { ownerID: 'someone-else' }), 'me')).toBe(false);
    });

    it('refuses an editor -- sharing administers the ACL, which only the direct owner may do', () =>
    {
        expect(canShareNode(file('a', { ownerID: 'someone-else', role: 'editor' }), 'me')).toBe(false);
    });

    it('refuses a contribution whose inherited role reads owner but whose direct owner is someone else', () =>
    {
        expect(canShareNode(file('a', { ownerID: 'contributor', role: 'owner' }), 'folder-owner')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('ownsSelection', () =>
{
    it('admits a selection where every node is directly owned by the caller', () =>
    {
        expect(ownsSelection([ file('a', { ownerID: 'me' }), folder('b', { ownerID: 'me' }) ], 'me')).toBe(true);
    });

    it('refuses the whole selection when one node is foreign, even if the rest are owned', () =>
    {
        const nodes = [ file('a', { ownerID: 'me' }), file('b', { ownerID: 'someone-else' }) ];

        expect(ownsSelection(nodes, 'me')).toBe(false);
    });

    it('refuses a wholly foreign selection', () =>
    {
        const nodes = [ file('a', { ownerID: 'someone-else' }), folder('b', { ownerID: 'someone-else' }) ];

        expect(ownsSelection(nodes, 'me')).toBe(false);
    });

    it('refuses an empty selection', () =>
    {
        expect(ownsSelection([], 'me')).toBe(false);
    });

    it('refuses a selection whose nodes all resolve role owner by inheritance but are not directly owned', () =>
    {
        // The exact shape a folder-link traversal or a shared folder's contributions produce: every child inherits
        // 'owner' from the parent's role, but ownerID still names the real contributor.
        const nodes = [
            file('a', { ownerID: 'contributor-1', role: 'owner' }),
            file('b', { ownerID: 'contributor-2', role: 'owner' }),
        ];

        expect(ownsSelection(nodes, 'folder-owner')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
