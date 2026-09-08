//----------------------------------------------------------------------------------------------------------------------
// Server Suite Setup
//
// Registered at file level, so this afterEach runs last -- a spec's own cleanup is an inner hook and goes first.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, afterEach } from 'vitest';

// Test support
import { RECLAIM_TIMEOUT_MS, closeAdminClient, dropProvisionedDatabases } from './database.ts';

//----------------------------------------------------------------------------------------------------------------------

afterEach(dropProvisionedDatabases, RECLAIM_TIMEOUT_MS);

// The admin connection is shared across every test in this file; nothing may hold it open once the file is done, or
// the worker cannot exit.
afterAll(closeAdminClient);

//----------------------------------------------------------------------------------------------------------------------
