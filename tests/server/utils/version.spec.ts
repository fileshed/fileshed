//----------------------------------------------------------------------------------------------------------------------
// resolveBuildInfo
//----------------------------------------------------------------------------------------------------------------------

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

// Models
import { SHORT_COMMIT_LENGTH } from '@fileshed/core';

// Utils
import { resolveBuildInfo } from '@server/utils/version.ts';

//----------------------------------------------------------------------------------------------------------------------

const rootManifest = createRequire(import.meta.url)('../../../package.json') as { version : string };

const FULL_SHA = 'a0931ee5c2d94b7f8e61c3a0b5d7e9f1a2b4c6d8';
const shortHash = new RegExp(`^[0-9a-f]{${ SHORT_COMMIT_LENGTH }}$`);

describe('resolveBuildInfo', () =>
{
    it('reports the workspace root\'s version, the one a release tags', () =>
    {
        const build = resolveBuildInfo({ COMMIT_SHA: FULL_SHA, COMMIT_REF: 'main' });

        expect(build.version).toBe(rootManifest.version);
    });

    it('reports the environment\'s commit as a readable prefix of the full hash', () =>
    {
        const { commit } = resolveBuildInfo({ COMMIT_SHA: FULL_SHA, COMMIT_REF: 'main' });

        expect(commit).toHaveLength(SHORT_COMMIT_LENGTH);
        expect(FULL_SHA.startsWith(commit ?? '-')).toBe(true);
    });

    // Run from a checkout, the repository has an answer of its own; the environment's has to win over it.
    it('takes the environment\'s branch over the repository\'s', () =>
    {
        const build = resolveBuildInfo({ COMMIT_SHA: FULL_SHA, COMMIT_REF: 'release/9.9' });

        expect(build.branch).toBe('release/9.9');
    });

    it('names no branch for a detached checkout', () =>
    {
        const build = resolveBuildInfo({ COMMIT_SHA: FULL_SHA, COMMIT_REF: 'HEAD' });

        expect(build.branch).toBeNull();
    });

    // A blank variable says nothing, so the answer is the repository's (a short hash) or nobody's (null).
    it('treats a blank variable as unset', () =>
    {
        const { commit } = resolveBuildInfo({ COMMIT_SHA: '   ', COMMIT_REF: 'main' });

        expect(commit === null || shortHash.test(commit)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
