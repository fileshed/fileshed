//----------------------------------------------------------------------------------------------------------------------
// Tree Constants
//----------------------------------------------------------------------------------------------------------------------

// The hard ceiling on how far a parent-edge walk climbs. Real trees are nowhere near this deep -- it is a backstop, not
// a product limit. Cycle prevention should make a loop in the parent edges impossible, but permission resolution runs
// on every authenticated request, so a single corrupt edge must bound the recursive walk rather than spin it forever.
export const MAX_TREE_DEPTH = 256;

//----------------------------------------------------------------------------------------------------------------------
