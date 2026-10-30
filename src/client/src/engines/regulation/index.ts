//----------------------------------------------------------------------------------------------------------------------
// Regulation Engine
//
// Callers reach for `regulation.node.canMoveInto` through this facade rather than importing a domain file directly.
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
