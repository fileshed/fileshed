//----------------------------------------------------------------------------------------------------------------------
// Regulation Engine
//
// The cross-record legality layer: managers gather facts, this engine judges them and returns typed violations --
// never throwing, never touching I/O. Per-domain engines are composed into one facade grouped by domain (node
// placement, sharing, quota), so a manager reaches for `regulation.node.link`, `regulation.share.grant`,
// `regulation.quota.admit`, and combines verdicts with `regulation.combine`.
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
// Re-exports
//----------------------------------------------------------------------------------------------------------------------

export type { RegulationResult } from './types.ts';
export { combine, resultOf } from './types.ts';

export type {
    LinkCreationFacts,
    ParentEdgeFacts,
    PlacementDepthFacts,
    MoveFacts,
    TrashFacts,
    CopyFacts,
    ReplaceFacts,
} from './node.ts';
export {
    judgeLinkCreation,
    judgeParentEdge,
    judgePlacementDepth,
    judgeMove,
    judgeTrash,
    judgeCopy,
    judgeReplace,
} from './node.ts';

export type { GrantFacts, ShareRequestResolutionFacts } from './share.ts';
export { judgeGrant, judgeShareRequestResolution } from './share.ts';

export type { QuotaFacts } from './quota.ts';
export { judgeQuotaAdmission } from './quota.ts';

//----------------------------------------------------------------------------------------------------------------------
