//----------------------------------------------------------------------------------------------------------------------
// Regulation Engine
//
// Managers gather the facts; this engine judges them and returns typed violations. It never throws and never touches
// I/O.
//----------------------------------------------------------------------------------------------------------------------

// Regulation
import { combine } from './types.ts';
import {
    judgeCopy,
    judgeLinkCreation,
    judgeMove,
    judgeParentEdge,
    judgePlacementDepth,
    judgeReplace,
    judgeTrash,
} from './node.ts';
import { judgeGrant, judgeShareRequestResolution } from './share.ts';
import { judgeQuotaAdmission } from './quota.ts';

//----------------------------------------------------------------------------------------------------------------------

export const regulation = {
    node: {
        link: judgeLinkCreation,
        parentEdge: judgeParentEdge,
        placementDepth: judgePlacementDepth,
        move: judgeMove,
        trash: judgeTrash,
        copy: judgeCopy,
        replace: judgeReplace,
    },
    share: {
        grant: judgeGrant,
        resolveRequest: judgeShareRequestResolution,
    },
    quota: {
        admit: judgeQuotaAdmission,
    },
    combine,
} as const;

//----------------------------------------------------------------------------------------------------------------------

export type { RegulationResult } from './types.ts';

//----------------------------------------------------------------------------------------------------------------------
