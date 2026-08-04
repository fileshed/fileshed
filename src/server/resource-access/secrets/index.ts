//----------------------------------------------------------------------------------------------------------------------
// Auth Secret File Resource Access
//
// The secret on disk. It is deliberately not a database row: SecretBox seals stored settings with a key derived
// from this value, and a key living in the same database as the ciphertext it opens would travel with every dump.
//
// create() is the first-boot race primitive -- O_EXCL means exactly one of several processes starting against an
// empty data directory creates the file, and the losers read what the winner wrote.
//----------------------------------------------------------------------------------------------------------------------

import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

// Models
import { AUTH_SECRET_FILE_MODE } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

function isMissing(error : unknown) : boolean
{
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export function describeFileError(error : unknown) : string
{
    const code = (error as NodeJS.ErrnoException | null)?.code;

    return typeof code === 'string' ? code : String(error);
}

//----------------------------------------------------------------------------------------------------------------------

// The secret the file holds, or null when there is no file. A file that exists but holds nothing is neither: an
// empty secret cannot sign anything, and overwriting it would be FileShed guessing at what was meant to be there.
export async function readSecretFile(path : string) : Promise<string | null>
{
    let contents : string;

    try
    {
        contents = await readFile(path, 'utf8');
    }
    catch(error)
    {
        if(isMissing(error)) { return null; }

        throw error;
    }

    const secret = contents.trim();
    if(secret === '')
    {
        throw new Error(`The secret file at '${ path }' is empty. Delete it to have a new secret generated, or `
            + 'put the secret it should hold back in it.');
    }

    return secret;
}

// True when this call created the file, false when another process got there first. Either way the caller reads
// the file back afterwards: the value that landed is the instance's, whoever wrote it.
export async function createSecretFile(path : string, secret : string) : Promise<boolean>
{
    await mkdir(dirname(path), { recursive: true });

    let handle;
    try
    {
        handle = await open(path, 'wx', AUTH_SECRET_FILE_MODE);
    }
    catch(error)
    {
        if((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') { return false; }

        throw error;
    }

    try { await handle.write(`${ secret }\n`); }
    finally { await handle.close(); }

    return true;
}

export async function removeSecretFile(path : string) : Promise<void>
{
    try { await unlink(path); }
    catch(error)
    {
        if(!isMissing(error)) { throw error; }
    }
}

//----------------------------------------------------------------------------------------------------------------------
