//----------------------------------------------------------------------------------------------------------------------
// Migration 008 — Natural Name Collation
//
// Postgres orders names naturally through an ICU collation, so `track-9` comes back ahead of `track-10` and a folder
// past the listing ceiling reads the same way the client would have sorted it. The collation is non-deterministic on
// purpose: a deterministic one settles a residual tie by comparing bytes inside the ORDER BY term itself, which robs
// the id tiebreak of its turn and puts `file01` and `file1` in an order no other tier agrees with.
//
// SQLite has no collation to create. It has no ICU at all, and JS offers an ICU comparator but no ICU sort key, so
// there is nothing to register that would order the same way; that dialect sorts names in Node instead (see NodeRA).
//
// A Postgres built without ICU cannot serve this migration, and it stops rather than degrading -- see
// assertICUAvailable for why silence is the worse of the two failures.
//
// The index carries the folder listing's whole ordering -- the folder partition, the collated name, the id tiebreak --
// under the predicate the listing runs with, so a page reads straight off it rather than sorting the folder. It serves
// the ascending direction only: descending asks for the folder partition ascending and the name descending, which no
// single-direction index can walk, so that direction sorts the folder the way every folder listing did before.
//----------------------------------------------------------------------------------------------------------------------

import { type Kysely, sql } from 'kysely';

// Models
import { NATURAL_ORDER_COLLATION, NATURAL_ORDER_ICU_LOCALE } from '@fileshed/core';

// Resource Access
import type { DatabaseKind } from '../database.ts';

//----------------------------------------------------------------------------------------------------------------------

const INDEX_NAME = 'node_natural_name_idx';

// What an operator reads at boot instead of the driver's own "ICU is not supported in this build", which says nothing
// about what FileShed wanted ICU for or what to do next.
export const ICU_REQUIRED_MESSAGE = 'FileShed orders names through an ICU collation, and this Postgres server reports '
    + 'none, so it was built without ICU support. Migration 008 has changed nothing. Point FileShed at a Postgres '
    + 'built with ICU, or deploy on SQLite, which orders names in the server instead.';

//----------------------------------------------------------------------------------------------------------------------

// A build without ICU creates no ICU collations, so the catalog answers the question the CREATE below would otherwise
// answer with a raw driver error.
export async function icuCollationCount(db : Kysely<unknown>) : Promise<number>
{
    const result = await sql<{ icu : number }>`
        select count(*)::int as icu from pg_collation where collprovider = 'i'
    `.execute(db);

    return result.rows[0]?.icu ?? 0;
}

// Missing ICU stops the migration rather than falling back to the lexical ordering. A deployment that quietly ordered
// its listings differently from the client and from every other deployment is the divergence this collation exists to
// remove, and a logged warning does not repair it -- nothing would retry the migration afterwards. Stopping here
// leaves the schema untouched, so the operator can move to an ICU build and boot again.
export function assertICUAvailable(icuCollations : number) : void
{
    if(icuCollations === 0) { throw new Error(ICU_REQUIRED_MESSAGE); }
}

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>, kind : DatabaseKind) : Promise<void>
{
    if(kind !== 'postgres') { return; }

    assertICUAvailable(await icuCollationCount(db));

    await sql`
        create collation ${ sql.ref(NATURAL_ORDER_COLLATION) }
            (provider = icu, locale = ${ sql.lit(NATURAL_ORDER_ICU_LOCALE) }, deterministic = false)
    `.execute(db);

    await sql`
        create index ${ sql.ref(INDEX_NAME) } on ${ sql.table('node') } (
            parent_id,
            (case when type = 'folder' then 0 else 1 end),
            name collate ${ sql.ref(NATURAL_ORDER_COLLATION) },
            id
        ) where trashed_at is null
    `.execute(db);
}

export async function down(db : Kysely<unknown>, kind : DatabaseKind) : Promise<void>
{
    if(kind !== 'postgres') { return; }

    await sql`drop index if exists ${ sql.ref(INDEX_NAME) }`.execute(db);
    await sql`drop collation if exists ${ sql.ref(NATURAL_ORDER_COLLATION) }`.execute(db);
}

//----------------------------------------------------------------------------------------------------------------------
