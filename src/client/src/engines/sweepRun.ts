//----------------------------------------------------------------------------------------------------------------------
// Sweep Run Descriptions
//
// One sentence per sweep outcome, written once so the card on the Overview and the toast that answers a run-now press
// can never quote different numbers for the same run. Each sweep counts different things, so each gets its own line
// rather than a shared vocabulary that would fit none of them.
//----------------------------------------------------------------------------------------------------------------------

import type { GcRunSummary, SweepRunResponse, TrashPurgeRunSummary } from '@fileshed/core';

// Utils
import { formatBytes } from '../utils/formatters/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// Bytes reclaimed is the figure an admin pressed the button for, so it leads. Leaked bytes are named only when there
// are any: a clean sweep has nothing to confess, and a permanent "0 failed" trains people to stop reading the line.
export function describeGcRun(summary : GcRunSummary) : string
{
    const parts = [
        `${ formatBytes(summary.bytesFreed) } reclaimed`,
        `${ summary.deleted } of ${ summary.candidates } collected`,
    ];

    if(summary.kept > 0) { parts.push(`${ summary.kept } back in use`); }
    if(summary.bytesFailed > 0) { parts.push(`${ summary.bytesFailed } left behind`); }

    return `${ parts.join(', ') }.`;
}

// Counted in items rather than bytes. What a purge hands back is quota, and the bytes on disk only return once the
// blobs it graveyarded outlive their grace window and the collector takes them -- quoting a byte figure here would
// promise space that is not free yet.
export function describeTrashPurgeRun(summary : TrashPurgeRunSummary) : string
{
    const parts = [ `${ summary.purged } of ${ summary.candidates } purged` ];

    if(summary.failed > 0) { parts.push(`${ summary.failed } failed`); }

    return `${ parts.join(', ') }.`;
}

export function describeSweepRun(run : SweepRunResponse) : string
{
    return run.sweep === 'gc' ? describeGcRun(run.summary) : describeTrashPurgeRun(run.summary);
}

//----------------------------------------------------------------------------------------------------------------------
