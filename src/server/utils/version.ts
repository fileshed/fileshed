//----------------------------------------------------------------------------------------------------------------------
// Instance Build Info
//
// What FileShed reports itself as. Deliberately the WORKSPACE ROOT's version, not @fileshed/server's -- the instance
// ships as one product, and the root manifest is the thing that gets tagged.
//
// The commit and branch are read from the environment first and the repository second: an image carries no history to
// ask, so whatever builds it bakes the facts in, while a checkout has the repository itself and needs nothing baked.
// All of it resolves once at module load -- nothing serving a request may touch the filesystem or spawn a process for
// it, and none of it can change while the process lives.
//----------------------------------------------------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Constants
import { GIT_PROBE_TIMEOUT_MS, SHORT_COMMIT_LENGTH } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface BuildInfo
{
    version : string;

    // Null when neither the environment nor a repository answered: an image built without the facts, or an install
    // from a tarball with no history behind it.
    commit : string | null;
    branch : string | null;
}

//----------------------------------------------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const manifest = require('../../../package.json') as { version : string };

function fromEnvironment(name : string) : string | null
{
    const value = process.env[name]?.trim() ?? '';

    return value === '' ? null : value;
}

// A checkout answers. An image has no git binary and no history, so the call throws and the build reports nothing,
// which is the honest answer rather than a failure.
function fromGit(...args : string[]) : string | null
{
    try
    {
        const output = execFileSync('git', args, {
            cwd: import.meta.dirname,
            encoding: 'utf8',
            timeout: GIT_PROBE_TIMEOUT_MS,
            stdio: [ 'ignore', 'pipe', 'ignore' ],
        }).trim();

        return output === '' ? null : output;
    }
    catch { return null; }
}

const commit = fromEnvironment('COMMIT_SHA') ?? fromGit('rev-parse', 'HEAD');
const branch = fromEnvironment('COMMIT_REF') ?? fromGit('rev-parse', '--abbrev-ref', 'HEAD');

export const BUILD_INFO : BuildInfo = {
    version: manifest.version,

    // The environment carries a full hash; the label wants a readable one.
    commit: commit === null ? null : commit.slice(0, SHORT_COMMIT_LENGTH),

    // A detached checkout -- which is every tag build -- calls itself HEAD, and that names no branch.
    branch: branch === null || branch === 'HEAD' ? null : branch,
};

//----------------------------------------------------------------------------------------------------------------------
