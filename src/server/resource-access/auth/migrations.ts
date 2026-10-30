//----------------------------------------------------------------------------------------------------------------------
// Auth Schema Migrations
//----------------------------------------------------------------------------------------------------------------------

import { getMigrations } from 'better-auth/db/migration';

// Resource Access
import { backfillAccountIssuer } from './accountIssuer.ts';
import type { AuthOptions } from './instance.ts';
import type { DatabaseHandle } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

// better-auth's migrator introspects the live schema and creates only what is missing, so it is safe to run on every
// boot and stays in step with the installed version and enabled plugins.
//
// One thing has to happen before it: better-auth refuses to add a required column with no default to a table that
// already has rows, so a database written before it keyed accounts on (issuer, accountId) has to carry that column
// already or the boot stops there instead of upgrading.
export async function migrateAuthSchema(handle : DatabaseHandle, authOptions : AuthOptions) : Promise<void>
{
    await backfillAccountIssuer(handle);

    const { runMigrations } = await getMigrations(authOptions);
    await runMigrations();
}

//----------------------------------------------------------------------------------------------------------------------
