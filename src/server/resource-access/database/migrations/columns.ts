//----------------------------------------------------------------------------------------------------------------------
// Dialect-Aware Column Helpers
//
// The handful of column types and default literals that differ between Postgres and SQLite (requirements.md sec 2:
// Postgres is primary, SQLite gets the workaround). Migrations stay readable by naming the intent -- a timestamp, a
// boolean -- and letting these pick the concrete type per dialect. See database.ts for the round-trip representation.
//----------------------------------------------------------------------------------------------------------------------

import type { ColumnDataType } from 'kysely';

// Database
import type { DatabaseKind } from '../database.ts';

//----------------------------------------------------------------------------------------------------------------------

// timestamptz preserves instant + zone on Postgres; SQLite has no date type, so ISO-8601 text (lexicographically
// ordered for UTC strings) is the house idiom.
export function timestampType(kind : DatabaseKind) : ColumnDataType
{
    return kind === 'postgres' ? 'timestamptz' : 'text';
}

// Native boolean on Postgres; SQLite stores 0/1 in an integer column (better-sqlite3 will not bind a JS boolean).
export function boolType(kind : DatabaseKind) : ColumnDataType
{
    return kind === 'postgres' ? 'boolean' : 'integer';
}

// 64-bit integer for sizes and quotas. SQLite's INTEGER is already 64-bit; Postgres needs bigint spelled out.
export function bigIntType(kind : DatabaseKind) : ColumnDataType
{
    return kind === 'postgres' ? 'bigint' : 'integer';
}

// A boolean DEFAULT literal in the dialect's own terms: the keyword on Postgres, 0/1 on SQLite.
export function boolDefault(kind : DatabaseKind, value : boolean) : boolean | number
{
    return kind === 'postgres' ? value : Number(value);
}

//----------------------------------------------------------------------------------------------------------------------
