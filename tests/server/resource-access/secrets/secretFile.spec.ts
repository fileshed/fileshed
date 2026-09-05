//----------------------------------------------------------------------------------------------------------------------
// Auth Secret File — the first-boot race
//
// The contract: exactly one of several callers starting against an empty data directory creates the file, the rest are
// told they lost, and every one of them then reads the same complete secret back.
//
// The property that matters most is not asserted here, because it cannot be: the file must never exist holding
// nothing, and an empty secret file refuses the boot telling an operator to delete a file that is about to be
// perfectly good. It is unreachable by construction rather than by test -- the secret is written to a temporary file
// and linked into place, so the directory entry only ever appears pointing at an inode that already holds the whole
// secret. A test can only race it, and racing it proves nothing: a probe that hammers this on a developer's machine
// passes against the broken implementation too, which is how the window survived to be found by CI on a loaded
// runner in the first place.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Models
import { AUTH_SECRET_FILE_MODE } from '@fileshed/core';

// Resource Access
import { createSecretFile, readSecretFile } from '@server/resource-access/secrets/index.ts';

//----------------------------------------------------------------------------------------------------------------------

const SECRET = 'a-secret-of-at-least-thirty-two-characters';

let directory : string;
let path : string;

beforeEach(async () =>
{
    directory = await mkdtemp(join(tmpdir(), 'fileshed-secret-file-'));
    path = join(directory, 'auth-secret');
});

afterEach(async () =>
{
    await rm(directory, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('createSecretFile', () =>
{
    it('tells exactly one of a crowd of callers that it created the file', async () =>
    {
        const outcomes = await Promise.all(
            Array.from({ length: 12 }, (_unused, index) => createSecretFile(path, `${ SECRET }-${ index }`))
        );

        expect(outcomes.filter(Boolean)).toHaveLength(1);
        expect(await readSecretFile(path)).toMatch(new RegExp(`^${ SECRET }-\\d+$`, 'u'));
    });

    it('leaves the file readable by nobody but its owner', async () =>
    {
        await createSecretFile(path, SECRET);

        expect((await stat(path)).mode & 0o777).toBe(AUTH_SECRET_FILE_MODE);
    });

    it('leaves nothing behind beside the file it created', async () =>
    {
        await Promise.all(Array.from({ length: 4 }, () => createSecretFile(path, SECRET)));

        const { readdir } = await import('node:fs/promises');

        expect(await readdir(directory)).toEqual([ 'auth-secret' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
