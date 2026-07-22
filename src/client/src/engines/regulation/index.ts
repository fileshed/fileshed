//----------------------------------------------------------------------------------------------------------------------
// Regulation Engine
//
// The client-side legality layer: pure judgments over node placement, no I/O. Per-domain engines compose into one
// facade grouped by domain, so a caller reaches for `regulation.node.canMoveInto` rather than importing the chunk
// file directly.
//----------------------------------------------------------------------------------------------------------------------

// Regulation
import { canEnterFolder, canEnterFolderForMove, canMoveAllInto, canMoveInto } from './node.ts';

//----------------------------------------------------------------------------------------------------------------------

export const regulation = {
    node: {
        canMoveInto,
        canEnterFolder,
        canMoveAllInto,
        canEnterFolderForMove,
    },
} as const;

//----------------------------------------------------------------------------------------------------------------------
// Re-exports
//----------------------------------------------------------------------------------------------------------------------

export { canMoveInto, canEnterFolder, canMoveAllInto, canEnterFolderForMove } from './node.ts';

//----------------------------------------------------------------------------------------------------------------------
