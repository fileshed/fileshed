//----------------------------------------------------------------------------------------------------------------------
// Boot Orchestration
//
// Brings the database from empty to ready. The order is a hard constraint: better-auth's own migrator must create
// the identity tables (user/session/account/verification + the role and quota_limit columns it owns) BEFORE the
// app migrations run, because the app tables carry FKs to user.id. First-run admin creation is NOT boot's job --
// the setup wizard owns it (managers/setup.ts), gated by its one-time code.
//----------------------------------------------------------------------------------------------------------------------

import { getMigrations } from 'better-auth/db/migration';

// Resource Access
import { backfillAccountIssuer } from './database/accountIssuer.ts';
import type { Auth } from './auth.ts';
import type { DatabaseHandle } from './database/database.ts';
import { migrateToLatest } from './database/migrator.ts';

// better-auth's migrator introspects the live schema and creates only what is missing, so it is safe to run on every
// boot and stays in step with the installed version and enabled plugins. The app migrations follow.
//
// One thing has to happen before it: better-auth refuses to add a required column with no default to a table that
// already has rows, so a database written before it keyed accounts on (issuer, accountId) has to carry that column
// already or the boot stops there instead of upgrading.
export async function runMigrations(handle : DatabaseHandle, auth : Auth) : Promise<void>
{
    await backfillAccountIssuer(handle);

    const { runMigrations: runAuthMigrations } = await getMigrations(auth.options);
    await runAuthMigrations();

    await migrateToLatest(handle.db, handle.kind);
}

//----------------------------------------------------------------------------------------------------------------------

export async function initialize(handle : DatabaseHandle, auth : Auth) : Promise<void>
{
    await runMigrations(handle, auth);
}

//----------------------------------------------------------------------------------------------------------------------
