//----------------------------------------------------------------------------------------------------------------------
// SettingsRA — override rows
//
// A stored override survives the round trip: whatever upsert takes, get answers back. JSON.stringify answers the
// *value* undefined -- not a string -- for undefined, functions and symbols, so a write of one cannot be honoured. It
// is refused at the seam that made the mistake, naming the key, and the store is left exactly as it was. A read of a
// row that is not JSON is refused the same way, as a corrupt row.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- a seeded row names snake_case DB columns (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { RowCorruptionError } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { SettingsRA } from '@server/resource-access/settings/index.ts';

// Support
import { createTestDatabase } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let settings : SettingsRA;

beforeEach(async () =>
{
    handle = await createTestDatabase();
    settings = new SettingsRA(handle);
});

afterEach(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('SettingsRA.upsert', () =>
{
    it('refuses a value JSON cannot represent, naming the key', async () =>
    {
        await expect(settings.upsert('SIGN_UP_ENABLED', undefined)).rejects.toThrow(/SIGN_UP_ENABLED/);
        await expect(settings.upsert('INSTANCE_NAME', () => true)).rejects.toThrow(/INSTANCE_NAME/);
        await expect(settings.upsert('SMTP_HOST', Symbol('nope'))).rejects.toThrow(/SMTP_HOST/);
    });

    it('leaves the key unset when a first write cannot be represented', async () =>
    {
        await expect(settings.upsert('SIGN_UP_ENABLED', undefined)).rejects.toThrow();

        expect(await settings.get('SIGN_UP_ENABLED')).toBeUndefined();
        expect((await settings.all()).map((row) => row.key)).not.toContain('SIGN_UP_ENABLED');
    });

    it('leaves an existing override intact when a later write cannot be represented', async () =>
    {
        await settings.upsert('INSTANCE_NAME', 'The Shed');

        await expect(settings.upsert('INSTANCE_NAME', () => true)).rejects.toThrow();

        expect(await settings.get('INSTANCE_NAME')).toBe('The Shed');
    });
});

//----------------------------------------------------------------------------------------------------------------------

// Every value is written as JSON, so a row that will not parse was put there by something other than this RA.
describe('SettingsRA reads', () =>
{
    beforeEach(async () =>
    {
        await handle.db
            .insertInto('instance_setting')
            .values({ key: 'INSTANCE_NAME', value: '{not json', updated_at: new Date().toISOString() })
            .execute();
    });

    it('refuses a stored value that is not JSON as a corrupt row, naming its key', async () =>
    {
        await expect(settings.get('INSTANCE_NAME')).rejects.toThrow(RowCorruptionError);
        await expect(settings.get('INSTANCE_NAME')).rejects.toThrow(/INSTANCE_NAME/);
    });

    it('refuses the whole listing the same way', async () =>
    {
        await expect(settings.all()).rejects.toThrow(RowCorruptionError);
    });
});

//----------------------------------------------------------------------------------------------------------------------
