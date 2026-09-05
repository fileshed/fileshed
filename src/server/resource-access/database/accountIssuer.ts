//----------------------------------------------------------------------------------------------------------------------
// Account Issuer Backfill
//
// Runs ahead of better-auth's own migrator, and only against a database written before better-auth keyed an account on
// (issuer, accountId). That migrator refuses to add a required column with no default to a table that already holds
// rows, so an instance that has ever had one account would stop booting rather than upgrade.
//
// The values are the ones such a row can justify. An older row records which connection an operator configured, not
// which authority actually verified the identity, so every account gets better-auth's synthetic namespace instead of a
// real issuer URL -- `local:credential` for email and password, `local:oauth:<provider>` for the rest.
//----------------------------------------------------------------------------------------------------------------------

import { sql } from 'kysely';

// Resource Access
import type { DatabaseHandle } from './database.ts';

//----------------------------------------------------------------------------------------------------------------------

// The identity table is better-auth's, and it names its columns in camelCase -- quoted, because Postgres folds an
// unquoted identifier to lower case and would look for `providerid`.
const ACCOUNT_COLUMNS = {
    sqlite: sql<{ name : string }>`select name from pragma_table_info('account')`,
    postgres: sql<{ name : string }>`
        select column_name as name from information_schema.columns where table_name = 'account'
    `,
};

async function accountColumns(handle : DatabaseHandle) : Promise<Set<string>>
{
    const { rows } = await ACCOUNT_COLUMNS[handle.kind].execute(handle.db);

    return new Set(rows.map((row) => row.name));
}

//----------------------------------------------------------------------------------------------------------------------

export async function backfillAccountIssuer(handle : DatabaseHandle) : Promise<void>
{
    const columns = await accountColumns(handle);

    // No table at all is a first boot, and a table that already has the column is a database better-auth has already
    // brought forward. Neither is ours to touch.
    if(columns.size === 0 || columns.has('issuer')) { return; }

    await sql`alter table account add column issuer text`.execute(handle.db);

    await sql`
        update account
        set issuer = case when "providerId" = 'credential' then 'local:credential'
                          else 'local:oauth:' || "providerId" end
    `.execute(handle.db);

    // The pair becomes a unique key the moment better-auth's migrator runs, and it builds the index without saying
    // which rows collided. Two accounts that were distinct under the old key and are not under the new one is a real
    // conflict in the data, so it is named here rather than surfacing as an index that would not build.
    const collisions = await sql<{ issuer : string; accountId : string }>`
        select issuer, "accountId" from account group by issuer, "accountId" having count(*) > 1
    `.execute(handle.db);

    if(collisions.rows.length > 0)
    {
        const named = collisions.rows.map((row) => `${ row.issuer } / ${ row.accountId }`).join(', ');

        throw new Error(
            'Two or more accounts now describe the same identity and cannot both be kept: '
            + `${ named }. Remove the duplicates from the account table and start the server again.`
        );
    }
}

//----------------------------------------------------------------------------------------------------------------------
