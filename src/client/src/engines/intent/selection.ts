//----------------------------------------------------------------------------------------------------------------------
// Selection Engine
//
// Pure selection logic for the drive surface: the click-to-selection state machine, and the action decisions the
// selection bar reads off the current multi-selection. No I/O -- every function returns a fresh value and the route
// component owns the effects.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------
// Selection Model
//
// The pure state machine behind clicking nodes in the grid or list. A plain click selects one; cmd/ctrl-click toggles
// a node in or out of a multi-selection; shift-click selects the contiguous range between the anchor and the clicked
// node in display order. The anchor is the pivot a range extends from -- a single or toggle click moves it; a range
// click leaves it put, so successive shift-clicks re-range from the same origin the way Finder and Explorer do. Every
// function returns a fresh state, so the caller's reactivity sees a new object rather than a mutated Set.
//----------------------------------------------------------------------------------------------------------------------

export interface SelectionState
{
    selected : ReadonlySet<string>;
    anchor : string | null;
}

// The modifier keys a click carried. Both false is a plain click.
export interface ClickModifiers
{
    toggle : boolean;
    range : boolean;
}

//----------------------------------------------------------------------------------------------------------------------

export function emptySelection() : SelectionState
{
    return { selected: new Set(), anchor: null };
}

// The whole selection reduced to one node, which is also the new anchor. A plain click lands here, and so does
// arriving in a folder pointed straight at a node -- a search result's go-to-folder.
export function selectOnly(id : string) : SelectionState
{
    return { selected: new Set([ id ]), anchor: id };
}

function toggle(state : SelectionState, id : string) : SelectionState
{
    const selected = new Set(state.selected);
    if(selected.has(id)) { selected.delete(id); }
    else { selected.add(id); }

    return { selected, anchor: id };
}

// The inclusive slice of display order between the anchor and the clicked id becomes the whole selection. With no
// anchor (nothing selected yet) or an anchor no longer in view, a shift-click degrades to a single select.
function selectRange(state : SelectionState, orderedIDs : readonly string[], id : string) : SelectionState
{
    if(state.anchor === null) { return selectOnly(id); }

    const anchorIndex = orderedIDs.indexOf(state.anchor);
    const targetIndex = orderedIDs.indexOf(id);
    if(anchorIndex === -1 || targetIndex === -1) { return selectOnly(id); }

    const [ from, to ] = anchorIndex <= targetIndex ? [ anchorIndex, targetIndex ] : [ targetIndex, anchorIndex ];
    const selected = new Set(orderedIDs.slice(from, to + 1));

    return { selected, anchor: state.anchor };
}

//----------------------------------------------------------------------------------------------------------------------

export function applyClick(
    state : SelectionState,
    orderedIDs : readonly string[],
    id : string,
    modifiers : ClickModifiers
) : SelectionState
{
    if(modifiers.range) { return selectRange(state, orderedIDs, id); }
    if(modifiers.toggle) { return toggle(state, id); }

    return selectOnly(id);
}

// A click on empty space, or an Escape, drops the whole selection.
export function clearSelection() : SelectionState
{
    return emptySelection();
}

// Prune ids that are no longer present (a page reload, a trashed node) so a stale id can't linger selected or serve
// as a dangling range anchor.
export function reconcile(state : SelectionState, presentIDs : readonly string[]) : SelectionState
{
    const present = new Set(presentIDs);
    const selected = new Set([ ...state.selected ].filter((id) => present.has(id)));
    const anchor = state.anchor !== null && present.has(state.anchor) ? state.anchor : null;

    return { selected, anchor };
}

//----------------------------------------------------------------------------------------------------------------------
// Selection Actions
//
// Pure decisions the selection bar reads off the current multi-selection. Copy is a file-only operation, so a folder or
// a link anywhere in the selection disables it. Trash and Remove split on the fact that links are never trashable: a
// selection of nothing but links is Removed (hard delete); once a file or folder is present the action is Trash, which
// sends those to the trash and leaves any links in place for the caller to note.
//----------------------------------------------------------------------------------------------------------------------

export type TrashMode = 'trash' | 'remove';

export interface TrashPlan
{
    mode : TrashMode;
    targetIDs : string[];
    skippedLinks : number;
}

//----------------------------------------------------------------------------------------------------------------------

// Copy asks nothing but read access, so any resolved role admits it; only the node's type gates it -- a folder roots a
// subtree and a link is an inert pointer, neither has a single blob to copy.
export function canCopyNode(node : NodeResponse) : boolean
{
    return node.type === 'file';
}

// An empty selection has nothing to copy.
export function canCopySelection(nodes : readonly NodeResponse[]) : boolean
{
    return nodes.length > 0 && nodes.every(canCopyNode);
}

// A links-only selection is a Remove of every link; otherwise it is a Trash of the files and folders, reporting how
// many links were left untouched so the caller can surface the skip.
export function planTrash(nodes : readonly NodeResponse[]) : TrashPlan
{
    const links = nodes.filter((node) => node.type === 'link');
    const trashables = nodes.filter((node) => node.type === 'file' || node.type === 'folder');

    if(trashables.length === 0)
    {
        return { mode: 'remove', targetIDs: links.map((node) => node.id), skippedLinks: 0 };
    }

    return { mode: 'trash', targetIDs: trashables.map((node) => node.id), skippedLinks: links.length };
}

//----------------------------------------------------------------------------------------------------------------------
// Ownership-Gated Actions
//
// Share, Rename, Move, and Trash/Remove administer a node -- its ACL or its place in the tree -- and the server admits
// each only from the node's DIRECT owner (node.ownerID), never the resolved `role` a folder owner also earns over a
// contribution someone else placed inside their own folder: that role reads 'owner' by inheritance, but the folder
// owner cannot rename, move, or trash a child they do not themselves own. So admission here keys off ownerID, not role.
// A bulk action on the whole selection admits only when EVERY selected node is the caller's own; one foreign node
// (a contribution, or a node reached through a traversed folder link) drops the action entirely rather than acting on
// a subset.
//----------------------------------------------------------------------------------------------------------------------

export function isOwnedBy(node : NodeResponse, userID : string | null) : boolean
{
    return userID !== null && node.ownerID === userID;
}

// A link carries no ACL of its own -- Share only ever targets a file or folder.
export function canShareNode(node : NodeResponse, userID : string | null) : boolean
{
    return node.type !== 'link' && isOwnedBy(node, userID);
}

export function ownsSelection(nodes : readonly NodeResponse[], userID : string | null) : boolean
{
    return nodes.length > 0 && nodes.every((node) => isOwnedBy(node, userID));
}

//----------------------------------------------------------------------------------------------------------------------
