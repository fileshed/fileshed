//----------------------------------------------------------------------------------------------------------------------
// Server Suite Global Setup
//
// Runs once in vitest's own process, before the first worker starts -- the only moment at which every test database
// on the server is provably somebody else's leftover.
//----------------------------------------------------------------------------------------------------------------------

// Test support
import { dropOrphanedDatabases } from './database.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function setup() : Promise<void>
{
    await dropOrphanedDatabases();
}

//----------------------------------------------------------------------------------------------------------------------
