//----------------------------------------------------------------------------------------------------------------------
// Upload Partials Reaper
//
// The scheduled sweep that reclaims the staging bytes of uploads that stopped delivering. A chunk pushes its ticket's
// expiry out and touches the staging bytes at the same moment, so staging untouched since a cutoff a whole ticket TTL
// back belongs to a ticket no chunk can be honoured against -- there is nothing left to resume and nobody left to
// resume it. That cutoff is the only thing separating an abandoned upload from a slow one, which is why the window is
// the ticket TTL rather than something tighter.
//
// Nothing here is correctness: an expired ticket is refused on use whether its bytes were reclaimed or not. What this
// bounds is what abandoned uploads cost in disk.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { PartialsRunSummary } from '@fileshed/core';

// Resource Access
import type { BlobRA } from '../resource-access/blob/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('partials');

//----------------------------------------------------------------------------------------------------------------------

export interface PartialsDeps
{
    blob : BlobRA;

    // How long staging must sit untouched before its upload counts as abandoned. The ticket TTL, read from the other
    // side: a chunk that lands renews both at once.
    ttlMs : number;
}

//----------------------------------------------------------------------------------------------------------------------

export async function runPartialsOnce(deps : PartialsDeps) : Promise<PartialsRunSummary>
{
    const swept = await deps.blob.sweepChunked(new Date(Date.now() - deps.ttlMs));

    const summary : PartialsRunSummary = {
        candidates: swept.candidates,
        reclaimed: swept.reclaimed,
        failed: swept.failed,
        bytesFreed: swept.bytesFreed,
    };

    const level = summary.failed > 0 ? 'warn' : (summary.candidates > 0 ? 'info' : 'debug');
    logger[level](summary, 'Partial upload sweep complete');

    return summary;
}

//----------------------------------------------------------------------------------------------------------------------
