//----------------------------------------------------------------------------------------------------------------------
// Regulation Engine
//
// The cross-record legality layer (requirements.md sec 3.6): managers gather facts, this engine judges them and returns
// typed violations -- never throwing, never touching I/O. Per-domain engines are composed into one facade grouped the
// way the requirements are (node placement, sharing, quota), so a manager reaches for `regulation.node.link`,
// `regulation.share.grant`, `regulation.quota.admit`, and combines verdicts with `regulation.combine`.
//----------------------------------------------------------------------------------------------------------------------

// Regulation
import { combine } from './types.ts';
import { judgeLinkCreation, judgeMove, judgeParentEdge, judgeTrash } from './node.ts';
import { judgeGrant, judgeShareRequestResolution } from './share.ts';
import { judgeQuotaAdmission } from './quota.ts';

//----------------------------------------------------------------------------------------------------------------------

export const regulation = {
    node: {
        link: judgeLinkCreation,
        parentEdge: judgeParentEdge,
        move: judgeMove,
        trash: judgeTrash,
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

export type { LinkCreationFacts, ParentEdgeFacts, MoveFacts, TrashFacts } from './node.ts';
export { judgeLinkCreation, judgeParentEdge, judgeMove, judgeTrash } from './node.ts';

export type { GrantFacts, ShareRequestResolutionFacts } from './share.ts';
export { judgeGrant, judgeShareRequestResolution } from './share.ts';

export type { QuotaFacts } from './quota.ts';
export { judgeQuotaAdmission } from './quota.ts';

//----------------------------------------------------------------------------------------------------------------------
