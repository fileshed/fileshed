//----------------------------------------------------------------------------------------------------------------------
// Default Backend Seed
//
// The seed is idempotent: an existing default fs backend is reused as-is, so the STORAGE_ROOT already recorded in its
// row wins over a changed env value. The config is validated here (parseFsBackendConfig) so a bad STORAGE_ROOT fails
// at boot rather than at first use.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- insert values name snake_case DB columns (house convention) */

import { createId } from '@paralleldrive/cuid2';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';
import { parseFsBackendConfig } from './fsBackend.ts';

// Utils
import type { Config } from '../../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// node:sqlite cannot bind a JS boolean, so is_default takes 1/0 on SQLite and true/false on Postgres (database.ts).
function trueBind(handle : DatabaseHandle) : boolean | number
{
    return handle.kind === 'postgres' ? true : 1;
}

//----------------------------------------------------------------------------------------------------------------------

export async function seedDefaultBackend(handle : DatabaseHandle, config : Config) : Promise<string>
{
    const existing = await handle.db
        .selectFrom('storage_backend')
        .select('id')
        .where('kind', '=', 'fs')
        .where('is_default', '=', trueBind(handle))
        .executeTakeFirst();

    if(existing) { return existing.id; }

    const backendID = createId();
    const backendConfig = parseFsBackendConfig({ root: config.STORAGE_ROOT });

    await handle.db
        .insertInto('storage_backend')
        .values({
            id: backendID,
            kind: 'fs',
            config: JSON.stringify(backendConfig),
            is_default: trueBind(handle),
        })
        .execute();

    return backendID;
}

//----------------------------------------------------------------------------------------------------------------------
