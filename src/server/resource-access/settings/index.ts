//----------------------------------------------------------------------------------------------------------------------
// Instance Settings Resource Access
//
// Layering over the config, typing and secret sealing belong to the settings manager; this RA only stores and fetches
// raw JSON values per key.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { RowCorruptionError } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface SettingRow
{
    key : string;
    value : unknown;
    updated : Date;
}

function decodeValue(key : string, stored : string) : unknown
{
    try { return JSON.parse(stored) as unknown; }
    catch { throw new RowCorruptionError('instance_setting', key, 'the value is not JSON'); }
}

export class SettingsRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    // Whether the table exists yet. The auth secret resolves BEFORE the migrations that create it -- better-auth's
    // migrator runs off the instance that secret constructs -- so on a first boot "no table" is the honest answer
    // to "is anything sealed in here", not a failure. Introspection answers it the same way on both dialects.
    async tableExists() : Promise<boolean>
    {
        const tables = await this.#db.introspection.getTables();

        return tables.some((table) => table.name === 'instance_setting');
    }

    async all() : Promise<SettingRow[]>
    {
        const rows = await this.#db
            .selectFrom('instance_setting')
            .selectAll()
            .execute();

        return rows.map((row) => ({
            key: row.key,
            value: decodeValue(row.key, row.value),
            updated: new Date(row.updated),
        }));
    }

    async get(key : string) : Promise<unknown>
    {
        const row = await this.#db
            .selectFrom('instance_setting')
            .select('value')
            .where('key', '=', key)
            .executeTakeFirst();

        return row === undefined ? undefined : decodeValue(key, row.value);
    }

    async upsert(key : string, value : unknown) : Promise<void>
    {
        // JSON.stringify answers the *value* undefined -- not a string -- for undefined, functions and symbols.
        const encoded = JSON.stringify(value);

        if(typeof encoded !== 'string')
        {
            throw new Error(`setting ${ key }: a value of type ${ typeof value } has no JSON representation`);
        }

        const stamp = new Date().toISOString();

        await this.#db
            .insertInto('instance_setting')
            .values({ key, value: encoded, updated: stamp })
            .onConflict((oc) => oc.column('key').doUpdateSet({ value: encoded, updated: stamp }))
            .execute();
    }

    async remove(key : string) : Promise<void>
    {
        await this.#db
            .deleteFrom('instance_setting')
            .where('key', '=', key)
            .execute();
    }
}

//----------------------------------------------------------------------------------------------------------------------
