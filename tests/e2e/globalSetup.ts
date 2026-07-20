//----------------------------------------------------------------------------------------------------------------------
// E2E Global Setup
//
// Sweeps temp directories leaked by earlier runs. spawnServer's stop() removes its own dirs, and the process-exit hook
// SIGKILLs any surviving child, but that hook is synchronous and cannot await an rm -- so a worker torn down mid-run
// strands its mkdtemp pair. This clears them at suite start.
//
// Only directories older than the staleness window are removed: a live run's dirs were created moments ago, so a
// second e2e suite running alongside this one keeps its own.
//----------------------------------------------------------------------------------------------------------------------

import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

//----------------------------------------------------------------------------------------------------------------------

const TEMP_DIR_PREFIX = 'fileshed-e2e-';
const STALE_AFTER_MS = 60 * 60 * 1000;

//----------------------------------------------------------------------------------------------------------------------

export default async function sweepStaleTempDirs() : Promise<void>
{
    const root = tmpdir();
    const entries = await readdir(root).catch(() => [] as string[]);

    await Promise.all(entries
        .filter((entry) => entry.startsWith(TEMP_DIR_PREFIX))
        .map(async (entry) =>
        {
            const path = join(root, entry);

            const info = await stat(path).catch(() => null);
            if(info === null || Date.now() - info.mtimeMs < STALE_AFTER_MS) { return; }

            await rm(path, { recursive: true, force: true });
        }));
}

//----------------------------------------------------------------------------------------------------------------------
