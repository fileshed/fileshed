//----------------------------------------------------------------------------------------------------------------------
// Instance Settings Resource Access
//
// The override rows, raw. Layering (override-over-config), typing, and secret handling are the manager's business;
// this surface only stores and fetches JSON values per key.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- insert values and update sets name snake_case DB columns (house convention) */

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface SettingRow
{
    key : string;
    value : unknown;
    updatedAt : Date;
}

export class SettingsRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    async all() : Promise<SettingRow[]>
    {
        const rows = await this.#db
            .selectFrom('instance_setting')
            .selectAll()
            .execute();

        return rows.map((row) => ({
            key: row.key,
            value: JSON.parse(row.value) as unknown,
            updatedAt: new Date(row.updated_at),
        }));
    }

    async get(key : string) : Promise<unknown>
    {
        const row = await this.#db
            .selectFrom('instance_setting')
            .select('value')
            .where('key', '=', key)
            .executeTakeFirst();

        return row === undefined ? undefined : JSON.parse(row.value) as unknown;
    }

    async upsert(key : string, value : unknown) : Promise<void>
    {
        const encoded = JSON.stringify(value);
        const stamp = new Date().toISOString();

        await this.#db
            .insertInto('instance_setting')
            .values({ key, value: encoded, updated_at: stamp })
            .onConflict((oc) => oc.column('key').doUpdateSet({ value: encoded, updated_at: stamp }))
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
