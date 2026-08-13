//----------------------------------------------------------------------------------------------------------------------
// Sweep Run Descriptions
//
// What an admin reads after a sweep. The rules the lines follow: reclaimed space leads on a collection because that is
// what the button was pressed for, a purge is counted in items rather than bytes because the disk space it hands back
// is not free yet, and a clause about something going wrong appears only when something did.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Under test
import { describeGcRun, describeSweepRun, describeTrashPurgeRun } from '@client/engines/sweepRun.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('describeGcRun', () =>
{
    it('leads with the space reclaimed, in units a person reads', () =>
    {
        const line = describeGcRun({ candidates: 4, deleted: 4, kept: 0, bytesFailed: 0, bytesFreed: 2_500_000 });

        expect(line).toBe('2.5 MB reclaimed, 4 of 4 collected.');
    });

    it('stays quiet about resurrected and leaked blobs when there were none', () =>
    {
        const line = describeGcRun({ candidates: 0, deleted: 0, kept: 0, bytesFailed: 0, bytesFreed: 0 });

        expect(line).toBe('0 B reclaimed, 0 of 0 collected.');
    });

    it('names the blobs that came back into use before the sweep reached them', () =>
    {
        const line = describeGcRun({ candidates: 3, deleted: 2, kept: 1, bytesFailed: 0, bytesFreed: 1024 });

        expect(line).toContain('1 back in use');
    });

    it('names the blobs whose bytes it could not delete', () =>
    {
        const line = describeGcRun({ candidates: 3, deleted: 2, kept: 0, bytesFailed: 1, bytesFreed: 1024 });

        expect(line).toContain('1 left behind');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('describeTrashPurgeRun', () =>
{
    it('counts what it purged rather than quoting bytes it has not freed yet', () =>
    {
        const line = describeTrashPurgeRun({ candidates: 6, purged: 6, failed: 0 });

        expect(line).toBe('6 of 6 purged.');
        expect(line).not.toMatch(/byte|kB|MB/i);
    });

    it('says so when a subtree would not go', () =>
    {
        const line = describeTrashPurgeRun({ candidates: 6, purged: 5, failed: 1 });

        expect(line).toBe('5 of 6 purged, 1 failed.');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('describeSweepRun', () =>
{
    it('describes each sweep in its own terms rather than a shared one that fits neither', () =>
    {
        const collected = describeSweepRun({
            sweep: 'gc',
            ranAt: '2026-08-12T10:00:00.000Z',
            summary: { candidates: 1, deleted: 1, kept: 0, bytesFailed: 0, bytesFreed: 4096 },
        });

        const purged = describeSweepRun({
            sweep: 'trashPurge',
            ranAt: '2026-08-12T10:00:00.000Z',
            summary: { candidates: 2, purged: 2, failed: 0 },
        });

        expect(collected).toBe('4.1 kB reclaimed, 1 of 1 collected.');
        expect(purged).toBe('2 of 2 purged.');
    });
});

//----------------------------------------------------------------------------------------------------------------------
