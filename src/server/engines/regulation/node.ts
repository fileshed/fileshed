//----------------------------------------------------------------------------------------------------------------------
// Node Regulation
//
// Cross-record legality for node placement: link creation, parent-edge legality, cycle prevention on real parent
// edges, and trash legality. Pure -- every fact the judgement needs is passed in; the manager gathers, the engine
// judges.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    MAX_PLACEMENT_DEPTH,
    type Node,
    type NodeType,
    type RegulationViolation,
    type Role,
    isDirectOwner,
    isRoleAtLeast,
} from '@fileshed/core';

// Regulation
import { type RegulationResult, resultOf } from './types.ts';

//----------------------------------------------------------------------------------------------------------------------

function isAtLeastEditor(role : Role | null) : boolean
{
    return isRoleAtLeast(role, 'editor');
}

//----------------------------------------------------------------------------------------------------------------------
// Link Creation
//----------------------------------------------------------------------------------------------------------------------

// The creator's effective role on the target, or null when they have no access -- gathered by the manager against the
// target's real ancestor chain, since links never conduct permissions.
export interface LinkCreationFacts
{
    linkID : string;
    targetNodeID : string;
    targetType : NodeType;
    creatorRoleOnTarget : Role | null;
}

// A link's target must be a file or folder (never a link), a link may not point at itself, and creating one requires
// ownership of or an active share on the target. Self-links onto a node you own are fine -- ownership shows up as a
// non-null role -- so no special casing beyond the self-target guard.
export function judgeLinkCreation(facts : LinkCreationFacts) : RegulationResult
{
    const violations : RegulationViolation[] = [];

    if(facts.targetType === 'link')
    {
        violations.push({
            code: 'link.targetIsLink',
            message: 'A link may not target another link.',
            targetNodeID: facts.targetNodeID,
        });
    }

    if(facts.targetNodeID === facts.linkID)
    {
        violations.push({
            code: 'link.selfTarget',
            message: 'A link may not target itself.',
            targetNodeID: facts.targetNodeID,
        });
    }

    if(facts.creatorRoleOnTarget === null)
    {
        violations.push({
            code: 'link.noAccess',
            message: 'Creating a link requires ownership of or an active share on the target.',
            targetNodeID: facts.targetNodeID,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
// Parent-Edge Legality
//----------------------------------------------------------------------------------------------------------------------

// `parent` is null for root-level placement. `creatorRoleOnParent` is the creator's effective role on the parent
// folder, gathered by the manager -- it authorizes the one sanctioned cross-owner edge.
export interface ParentEdgeFacts
{
    creatorID : string;
    parent : Node | null;
    creatorRoleOnParent : Role | null;
}

// A parent must be a folder that is not trashed, and owned by the creator -- with the single exception that an editor
// on a shared folder may create inside it (owner differs from parent's owner, the sanctioned cross-owner edge). Root
// placement (no parent) is always structurally legal.
export function judgeParentEdge(facts : ParentEdgeFacts) : RegulationResult
{
    const { parent } = facts;

    if(parent === null) { return resultOf([]); }

    if(parent.type !== 'folder')
    {
        return resultOf([ {
            code: 'parent.notFolder',
            message: 'A parent must be a folder.',
            parentID: parent.id,
        } ]);
    }

    const violations : RegulationViolation[] = [];

    if(parent.trashedAt !== null)
    {
        violations.push({
            code: 'parent.trashed',
            message: 'A parent folder may not be trashed.',
            parentID: parent.id,
        });
    }

    // The two authorities side by side: owning the parent outright, or holding a resolved editor+ role on it.
    if(!isDirectOwner(parent, facts.creatorID) && !isAtLeastEditor(facts.creatorRoleOnParent))
    {
        violations.push({
            code: 'parent.crossOwner',
            message: 'A node may only be placed under a folder owned by its creator, unless the creator is an editor '
                + 'on a folder shared to them.',
            parentID: parent.id,
            ownerID: parent.ownerID,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
// Placement Depth
//----------------------------------------------------------------------------------------------------------------------

// A placement stated as depth: how many ancestors the placed node itself would end up with (0 at a user's root), and
// how far its own subtree reaches below it -- 0 for a file, a link, or an empty folder. A move carries the subtree, so
// the pair together name the deepest node the placement would land.
export interface PlacementDepthFacts
{
    parentID : string | null;
    placedDepth : number;
    placedHeight : number;
}

// The depth ceiling, judged over the deepest node a placement would land rather than its root. Every parent-edge walk
// -- permission resolution above all -- climbs a bounded number of rungs and answers from what it saw, so a chain
// longer than that bound would be resolved from part of itself. Refusing the placement is what keeps the bound a fact
// about the tree instead of a hope.
export function judgePlacementDepth(facts : PlacementDepthFacts) : RegulationResult
{
    if(facts.placedDepth + facts.placedHeight <= MAX_PLACEMENT_DEPTH) { return resultOf([]); }

    const violation : RegulationViolation = {
        code: 'parent.tooDeep',
        message: `A node may not be nested more than ${ MAX_PLACEMENT_DEPTH } folders deep.`,
    };

    if(facts.parentID !== null) { violation.parentID = facts.parentID; }

    return resultOf([ violation ]);
}

//----------------------------------------------------------------------------------------------------------------------
// Move Cycle Prevention
//----------------------------------------------------------------------------------------------------------------------

// `parentAncestorIDs` is the id chain of the proposed parent's ancestors, from its own parent up to the root -- it does
// NOT include the proposed parent itself, which is checked separately. null `newParentID` is a move to the root.
export interface MoveFacts
{
    nodeID : string;
    newParentID : string | null;
    parentAncestorIDs : string[];
}

// Cycle prevention on real parent edges. A move is illegal if the node would become its own parent, or if it already
// sits above the destination (the moved node appears in the destination's ancestor chain). A move to the root can
// never form a cycle.
export function judgeMove(facts : MoveFacts) : RegulationResult
{
    if(facts.newParentID === null) { return resultOf([]); }

    const violations : RegulationViolation[] = [];

    if(facts.newParentID === facts.nodeID)
    {
        violations.push({
            code: 'move.intoSelf',
            message: 'A node may not be moved into itself.',
            nodeID: facts.nodeID,
            parentID: facts.newParentID,
        });
    }

    if(facts.parentAncestorIDs.includes(facts.nodeID))
    {
        violations.push({
            code: 'move.intoDescendant',
            message: 'A node may not be moved into one of its own descendants.',
            nodeID: facts.nodeID,
            parentID: facts.newParentID,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
// Trash Legality
//----------------------------------------------------------------------------------------------------------------------

export interface TrashFacts
{
    node : Node;
    actorID : string;
}

// Links are deleted directly, never trashed, and only a node's owner may trash it (recipients delete their link
// instead). Both conditions are reported so a recipient trashing someone else's link learns of each.
export function judgeTrash(facts : TrashFacts) : RegulationResult
{
    const { node } = facts;
    const violations : RegulationViolation[] = [];

    if(node.type === 'link')
    {
        violations.push({
            code: 'trash.linkNotTrashable',
            message: 'Links are deleted directly, never trashed.',
            nodeID: node.id,
        });
    }

    // Trashing is authority over the node, so it asks direct ownership -- an ancestor owner resolves 'owner' on a
    // cross-owner contribution and may read it, but the contributor's item stays theirs to trash.
    if(!isDirectOwner(node, facts.actorID))
    {
        violations.push({
            code: 'trash.notOwner',
            message: 'Only a node\'s owner may trash it.',
            nodeID: node.id,
            actorID: facts.actorID,
            ownerID: node.ownerID,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
// Copy Legality
//----------------------------------------------------------------------------------------------------------------------

export interface CopyFacts
{
    source : Node;
}

// Only a file may be saved as a copy: a folder roots a subtree with no single blob to reference, and a link is an inert
// pointer that carries no bytes. Ownership is not asked here -- a viewer may copy a file shared to them; the copy is
// charged to and owned by the caller, judged by quota and the parent edge separately.
export function judgeCopy(facts : CopyFacts) : RegulationResult
{
    if(facts.source.type !== 'file')
    {
        return resultOf([ {
            code: 'copy.sourceNotFile',
            message: 'Only a file may be saved as a copy.',
            nodeID: facts.source.id,
        } ]);
    }

    return resultOf([]);
}

//----------------------------------------------------------------------------------------------------------------------
// Replace Legality
//----------------------------------------------------------------------------------------------------------------------

// `actorRole` is the actor's effective role on the target, gathered by the manager (read-as-absent is handled there,
// so a non-null role reaches here).
export interface ReplaceFacts
{
    target : Node;
    actorRole : Role | null;
}

// Only a file's content may be replaced (a folder roots a subtree with no single blob, a link carries no bytes), and
// replacing content is an edit, so it requires editor-or-better on the target -- a viewer may read but not overwrite.
// Both are reported so a viewer aiming at a folder learns of each. Ownership of the CHARGE (the target's owner) is
// judged by quota separately: an editor may replace a file shared to them, spending the owner's quota, not their own.
export function judgeReplace(facts : ReplaceFacts) : RegulationResult
{
    const violations : RegulationViolation[] = [];

    if(facts.target.type !== 'file')
    {
        violations.push({
            code: 'replace.notFile',
            message: 'Only a file\'s content may be replaced.',
            nodeID: facts.target.id,
        });
    }

    if(!isAtLeastEditor(facts.actorRole))
    {
        violations.push({
            code: 'replace.notEditor',
            message: 'Replacing a file\'s content requires editor access or ownership.',
            nodeID: facts.target.id,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
