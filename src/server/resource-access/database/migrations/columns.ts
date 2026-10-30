//----------------------------------------------------------------------------------------------------------------------
// Dialect-Aware Column Helpers
//----------------------------------------------------------------------------------------------------------------------

import type { ColumnDataType } from 'kysely';

// Models
import type { DatabaseKind } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// timestamptz preserves instant + zone on Postgres; SQLite has no date type, so ISO-8601 text (lexicographically
// ordered for UTC strings) is the house idiom.
export function timestampType(kind : DatabaseKind) : ColumnDataType
{
    return kind === 'postgres' ? 'timestamptz' : 'text';
}

// Native boolean on Postgres; SQLite stores 0/1 in an integer column (node:sqlite will not bind a JS boolean).
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
