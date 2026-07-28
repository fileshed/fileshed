//----------------------------------------------------------------------------------------------------------------------
// Database Migrator
//
// Runs Kysely schema migrations from a static, explicitly-imported list rather than FileMigrationProvider, so they
// resolve reliably under native TypeScript execution and the Vitest runner (no runtime directory scan, no dynamic .ts
// import, no dist). Add new migrations to migrationList in order.
//
// Migrations are dialect-aware, but Kysely's Migration.up receives only the db handle. We bridge that by binding the
// active DatabaseKind into each migration closure here, so a migration signature stays (db, kind).
//----------------------------------------------------------------------------------------------------------------------

import { type Migration, type MigrationProvider, Migrator, NO_MIGRATIONS } from 'kysely/migration';

import type { Kysely } from 'kysely';

// Database
import type { Database, DatabaseKind } from './database.ts';

// Migrations
import * as initial001 from './migrations/001_initial.ts';
import * as mediaTags002 from './migrations/002_media_tags.ts';

// Utils
import { getLogger } from '../../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('migrator');

//----------------------------------------------------------------------------------------------------------------------

function migrationList(kind : DatabaseKind) : Record<string, Migration>
{
    return {
        '001_initial': {
            up: (db) => initial001.up(db, kind),
            down: (db) => initial001.down(db),
        },
        '002_media_tags': {
            up: (db) => mediaTags002.up(db),
            down: (db) => mediaTags002.down(db),
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------

class StaticMigrationProvider implements MigrationProvider
{
    readonly #migrations : Record<string, Migration>;

    constructor(migrations : Record<string, Migration>)
    {
        this.#migrations = migrations;
    }

    async getMigrations() : Promise<Record<string, Migration>>
    {
        return this.#migrations;
    }
}

//----------------------------------------------------------------------------------------------------------------------

function makeMigrator(db : Kysely<Database>, kind : DatabaseKind) : Migrator
{
    return new Migrator({ db, provider: new StaticMigrationProvider(migrationList(kind)) });
}

// Surface a failed migration with the name that broke, then rethrow. Shared by the up and down runners.
function reportFailures(results : { migrationName : string; status : string }[] | undefined, error : unknown) : void
{
    results?.forEach((result) =>
    {
        if(result.status === 'Error')
        {
            logger.error({ migration: result.migrationName }, 'Migration failed');
        }
    });

    if(error)
    {
        throw error instanceof Error ? error : new Error(String(error));
    }
}

//----------------------------------------------------------------------------------------------------------------------

export async function migrateToLatest(db : Kysely<Database>, kind : DatabaseKind) : Promise<void>
{
    const { error, results } = await makeMigrator(db, kind).migrateToLatest();
    reportFailures(results, error);
}

// Roll the schema all the way back to empty. Every migration's down() must fully reverse its up() so this leaves a
// clean database (verified in the specs).
export async function migrateDown(db : Kysely<Database>, kind : DatabaseKind) : Promise<void>
{
    const { error, results } = await makeMigrator(db, kind).migrateTo(NO_MIGRATIONS);
    reportFailures(results, error);
}

//----------------------------------------------------------------------------------------------------------------------
