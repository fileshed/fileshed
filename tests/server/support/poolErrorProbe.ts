//----------------------------------------------------------------------------------------------------------------------
// Pool Error Probe
//
// A process that parks one idle pooled connection so a spec can kill its backend and watch a real process, rather than
// a test worker with crash handlers of its own. It attaches nothing to the pool: whether an unlistened 'error' event
// ends this process is the entire question, and a listener here would answer it on the factory's behalf.
//
// Spawned by bare `node`, so the imports below are relative -- the @server alias is a vitest resolution, and nothing
// resolves it out here.
//----------------------------------------------------------------------------------------------------------------------

import { sql } from 'kysely';

// Resource Access
import { createDatabase } from '../../../src/server/resource-access/database/database.ts';

// Utils
import { loadConfig } from '../../../src/server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------
// Protocol
//----------------------------------------------------------------------------------------------------------------------

export type ProbeRequest = 'query' | 'stop';

export type ProbeReply = { kind : 'ready'; backendPID : number } | { kind : 'answered'; ok : boolean };

//----------------------------------------------------------------------------------------------------------------------

const { db } = createDatabase(loadConfig());

function reply(message : ProbeReply) : void
{
    process.send?.(message);
}

// The backend behind the single connection this process opens. Kysely hands the connection back when the query
// resolves, which parks it idle -- the state whose failures pg reports on the pool instead of on a caller.
async function backendPID() : Promise<number>
{
    const result = await sql<{ pid : number }>`select pg_backend_pid() as pid`.execute(db);
    const pid = result.rows[0]?.pid;

    if(pid === undefined) { throw new Error('Postgres reported no backend pid'); }

    return pid;
}

async function answersQuery() : Promise<boolean>
{
    try
    {
        const result = await sql<{ answer : number }>`select 1 as answer`.execute(db);

        return result.rows[0]?.answer === 1;
    }
    catch
    {
        return false;
    }
}

async function handle(message : unknown) : Promise<void>
{
    const request = message as ProbeRequest;

    if(request === 'query') { reply({ kind: 'answered', ok: await answersQuery() }); }
    if(request === 'stop') { await db.destroy(); process.disconnect?.(); }
}

process.on('message', (message : unknown) => { void handle(message); });

reply({ kind: 'ready', backendPID: await backendPID() });

//----------------------------------------------------------------------------------------------------------------------
