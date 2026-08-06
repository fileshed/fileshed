//----------------------------------------------------------------------------------------------------------------------
// Migration 007 — Public Link Kind Removal
//
// A public link used to carry a mode and a disposition that fixed how every response to its token presented itself.
// The token is the whole grant now and presentation rides the URL, so both columns go -- taking their CHECK
// constraints with them on both dialects. Every link survives: tokens, targets, and revocations are untouched, and
// one minted as a download link now serves inline by default with ?download for the other form. Nothing can put the
// kind back once the rows have lost it, so there is no down().
//----------------------------------------------------------------------------------------------------------------------

import type { Kysely } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    // One column per statement: SQLite's ALTER TABLE takes a single alteration at a time.
    await db.schema
        .alterTable('public_link')
        .dropColumn('mode')
        .execute();

    await db.schema
        .alterTable('public_link')
        .dropColumn('disposition')
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
