//----------------------------------------------------------------------------------------------------------------------
// Database Seeds
//
// One default backend per deployment. The upload/claim flow needs a storage_backend row for
// BlobRA to resolve and pin blob records to; this brings that row into being at boot from config, and is idempotent --
// an existing default fs backend is reused as-is, so restarts and the STORAGE_ROOT already recorded in the row win over
// a changed env value. v1 seeds the fs backend only; other kinds (db/s3/azure) are admin tooling.
//
// Only the row is seeded -- BlobRA builds the byte facade from it lazily, so the backend type stays behind the RA
// surface. The config is validated here (parseFsBackendConfig) so a bad STORAGE_ROOT fails at boot, not first use.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- insert values name snake_case DB columns (house convention) */

import { createId } from '@paralleldrive/cuid2';

// Resource Access
import type { DatabaseHandle } from './database.ts';
import { parseFsBackendConfig } from '../blob/fsBackend.ts';

// Utils
import type { Config } from '../../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// better-sqlite3 cannot bind a JS boolean, so is_default takes 1/0 on SQLite and true/false on Postgres (database.ts).
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
