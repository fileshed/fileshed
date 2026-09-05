//----------------------------------------------------------------------------------------------------------------------
// Tree Constants
//----------------------------------------------------------------------------------------------------------------------

// How many ancestors a parent-edge walk climbs before it stops. Permission resolution runs on every authenticated
// request, so a loop in the parent edges must bound the walk rather than spin it forever -- and a walk that stops
// short resolves a role from part of the chain. Placement is capped below so the walk always sees a whole one.
export const MAX_TREE_DEPTH = 256;

// The most ancestors a create or a move may give a node. One rung shallower than the walk, because the deepest folder
// a placement allows still has to hold files: an upload landing inside one sits at exactly MAX_TREE_DEPTH, which the
// walk reaches. Real trees are nowhere near this deep.
export const MAX_PLACEMENT_DEPTH = MAX_TREE_DEPTH - 1;

//----------------------------------------------------------------------------------------------------------------------
