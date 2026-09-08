//----------------------------------------------------------------------------------------------------------------------
// Server Suite Global Setup
//
// Runs once in vitest's own process, before the first worker starts -- the only moment at which every test database
// on the server is provably somebody else's leftover.
//----------------------------------------------------------------------------------------------------------------------

// Test support
import { closeAdminClient, dropOrphanedDatabases } from './database.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function setup() : Promise<void>
{
    await dropOrphanedDatabases();

    // This runs in vitest's own process, which has no afterAll to close what the sweep opened -- and an admin
    // connection left open here keeps the whole run from exiting once the last worker is done.
    await closeAdminClient();
}

//----------------------------------------------------------------------------------------------------------------------
