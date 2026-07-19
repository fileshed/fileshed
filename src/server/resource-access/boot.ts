//----------------------------------------------------------------------------------------------------------------------
// Boot Orchestration
//
// Brings the database from empty to ready, then plants the first-run admin. The order is a hard constraint:
// better-auth's own migrator must create the identity tables (user/session/account/verification + the role and
// quota_limit columns it owns) BEFORE the app migrations run, because the app tables carry FKs to user.id
// (requirements.md sec 3.6).
//
// server.ts calls initialize() before serving; the specs call it against an in-memory database.
//----------------------------------------------------------------------------------------------------------------------

import { getMigrations } from 'better-auth/db/migration';

// Resource Access
import type { Auth } from './auth.ts';
import type { DatabaseHandle } from './database/database.ts';
import { migrateToLatest } from './database/migrator.ts';

// Utils
import type { Config } from '../utils/config.ts';
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('boot');

//----------------------------------------------------------------------------------------------------------------------

// better-auth's migrator introspects the live schema and creates only what is missing, so it is safe to run on every
// boot and stays in step with the installed version and enabled plugins. The app migrations follow.
export async function runMigrations(handle : DatabaseHandle, auth : Auth) : Promise<void>
{
    const { runMigrations: runAuthMigrations } = await getMigrations(auth.options);
    await runAuthMigrations();

    await migrateToLatest(handle.db, handle.kind);
}

//----------------------------------------------------------------------------------------------------------------------

// First-run admin (requirements.md sec 9). Idempotent across restarts: an existing account for the configured email is
// promoted if it is not already admin and otherwise left alone, so a crash between the sign-up and the promotion heals
// on the next boot. Role is set with a direct Kysely update -- explicit and readable, and it keeps the auth config free
// of bootstrap-specific databaseHooks. No env pair configured means no bootstrap.
export async function bootstrapAdmin(handle : DatabaseHandle, auth : Auth, config : Config) : Promise<void>
{
    // better-auth lowercases emails on sign-up; normalize to match, or a mixed-case configured address would never
    // find the stored row -- the admin would be created but not promoted, and every later boot would re-attempt the
    // sign-up and crash on the duplicate.
    const email = config.FILESHED_ADMIN_EMAIL?.toLowerCase();
    const password = config.FILESHED_ADMIN_PASSWORD;

    if(!email || !password) { return; }

    const existing = await handle.db
        .selectFrom('user')
        .select([ 'id', 'role' ])
        .where('email', '=', email)
        .executeTakeFirst();

    if(existing)
    {
        if(existing.role !== 'admin')
        {
            await handle.db.updateTable('user').set({ role: 'admin' })
                .where('id', '=', existing.id)
                .execute();
            logger.info({ email }, 'Promoted existing account to admin during bootstrap');
        }
        return;
    }

    await auth.api.signUpEmail({ body: { email, name: 'Administrator', password } });
    await handle.db.updateTable('user').set({ role: 'admin' })
        .where('email', '=', email)
        .execute();

    logger.info({ email }, 'Created first-run admin');
}

//----------------------------------------------------------------------------------------------------------------------

export async function initialize(handle : DatabaseHandle, auth : Auth, config : Config) : Promise<void>
{
    await runMigrations(handle, auth);
    await bootstrapAdmin(handle, auth, config);
}

//----------------------------------------------------------------------------------------------------------------------
