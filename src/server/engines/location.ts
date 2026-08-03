//----------------------------------------------------------------------------------------------------------------------
// Location Engine
//
// Turns a node's stored ancestor chain into the location the caller is allowed to see. The chain is cut at the first
// ancestor they cannot resolve, so a hit reached through a share names the share root and nothing of the owner's tree
// above it.
//
// `foreign` answers where the surviving chain roots, and it is decided against the highest node the caller can still
// see -- the topmost surviving ancestor, or the node itself when none survive. A chain that reaches a null parent the
// caller owns is their own files root; anything else either stopped short or belongs to someone else. That is the same
// predicate the drive applies to its breadcrumb, which is what keeps a location and a breadcrumb from ever disagreeing
// about where a node lives.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { NodeLocation } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface LocationAncestor
{
    id : string;
    name : string;
    ownerID : string;
    parentID : string | null;
}

export interface LocationFacts
{
    // The node being located. Its own parent edge and owner anchor the walk when no ancestor survives the trim.
    ownerID : string;
    parentID : string | null;

    // Its stored ancestors, nearest parent first, untrimmed.
    ancestors : readonly LocationAncestor[];

    // The ancestors the caller can resolve. An id missing here ends the chain at that rung.
    visibleIDs : ReadonlySet<string>;

    actorID : string;
}

//----------------------------------------------------------------------------------------------------------------------

export function resolveLocation(facts : LocationFacts) : NodeLocation
{
    const visible : LocationAncestor[] = [];
    for(const ancestor of facts.ancestors)
    {
        if(!facts.visibleIDs.has(ancestor.id)) { break; }

        visible.push(ancestor);
    }

    const top = visible.at(-1) ?? { ownerID: facts.ownerID, parentID: facts.parentID };
    const crumbs = visible.reverse().map((ancestor) => ({ id: ancestor.id, name: ancestor.name }));

    return { crumbs, foreign: top.parentID !== null || top.ownerID !== facts.actorID };
}

//----------------------------------------------------------------------------------------------------------------------
