//----------------------------------------------------------------------------------------------------------------------
// Media Tag Backfill — the scheduled pass
//
// The backfill handles one batch per tick and is registered on the same interval as the database sweeps, so a pass
// slower than that interval -- a large library, a slow extractor, a contended host -- would have the next tick start
// on top of it, with both walking the same worklist and extracting the same files. A pass already running is skipped,
// exactly as the storage sweeps skip theirs, and the tag store is the only place that can show it: a skipped tick
// never asks for a worklist.
//----------------------------------------------------------------------------------------------------------------------

import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

// Resource Access
import type { BlobRA } from '@server/resource-access/blob/index.ts';
import type { MediaTagsRA, UntaggedBlob } from '@server/resource-access/mediaTags/index.ts';

// Managers
import { MediaTagManager } from '@server/managers/mediaTags.ts';

//----------------------------------------------------------------------------------------------------------------------

const BATCH = 10;

// The latch is decided before a candidate is opened, so no pass in this spec ever reaches the byte store.
const untouchedStore = {} as unknown as BlobRA;

// A tag store whose worklist can be held open, which is the only way to have a pass still running when the next tick
// arrives without waiting on real work. `requests` is what a skipped tick is visible in: it never asks.
interface HeldWorklist
{
    ra : MediaTagsRA;
    requests : number;
    hold() : void;
    release() : void;
}

function heldWorklist() : HeldWorklist
{
    let gate = Promise.withResolvers<null>();
    gate.resolve(null);

    const worklist : HeldWorklist = {
        requests: 0,
        hold: () => { gate = Promise.withResolvers<null>(); },
        release: () => gate.resolve(null),
        ra: {
            async untaggedAudioBlobs() : Promise<UntaggedBlob[]>
            {
                worklist.requests += 1;
                await gate.promise;

                return [];
            },
        } as unknown as MediaTagsRA,
    };

    return worklist;
}

// A pass that never answers must fail this spec rather than hang it: answering at once is the whole of what a skipped
// tick does.
async function within<T>(work : Promise<T>, ms : number, complaint : string) : Promise<T>
{
    const expired = delay(ms, undefined, { ref: false }).then(() : never => { throw new Error(complaint); });

    return Promise.race([ work, expired ]);
}

//----------------------------------------------------------------------------------------------------------------------

describe('MediaTagManager.runScheduled', () =>
{
    it('skips a tick that arrives while the previous pass is still running', async () =>
    {
        const worklist = heldWorklist();
        const manager = new MediaTagManager({ blob: untouchedStore, tags: worklist.ra });

        worklist.hold();
        const running = manager.runScheduled(BATCH);

        await within(manager.runScheduled(BATCH), 1_000, 'the tick landing mid-pass never returned');
        expect(worklist.requests).toBe(1);

        worklist.release();
        await running;
    });

    it('runs the next tick once the pass it collided with has finished', async () =>
    {
        const worklist = heldWorklist();
        const manager = new MediaTagManager({ blob: untouchedStore, tags: worklist.ra });

        worklist.hold();
        const running = manager.runScheduled(BATCH);
        await within(manager.runScheduled(BATCH), 1_000, 'the tick landing mid-pass never returned');

        worklist.release();
        await running;

        await manager.runScheduled(BATCH);
        expect(worklist.requests).toBe(2);
    });

    // A pass that throws must leave the backfill able to run again -- a latch held by a dead pass would stop the
    // library ever being tagged, for the life of the process, over one bad batch.
    it('releases the latch when a pass fails', async () =>
    {
        const failing = {
            untaggedAudioBlobs: async () : Promise<UntaggedBlob[]> => { throw new Error('worklist unavailable'); },
        } as unknown as MediaTagsRA;

        const manager = new MediaTagManager({ blob: untouchedStore, tags: failing });

        await expect(manager.runScheduled(BATCH)).rejects.toThrow('worklist unavailable');
        await expect(manager.runScheduled(BATCH)).rejects.toThrow('worklist unavailable');
    });
});

//----------------------------------------------------------------------------------------------------------------------
