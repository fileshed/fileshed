//----------------------------------------------------------------------------------------------------------------------
// Setup Manager
//
// The first-run wizard's backend. While no account exists, a one-time setup code gates admin creation: the code is
// either the operator's own FILESHED_SETUP_TOKEN (accepted but never printed -- it is already in their environment)
// or freshly generated at every boot and printed to the console, so possessing it proves log access -- the
// operator's credential-shaped thing. The admin's password arrives typed in the wizard and lands only as a hash;
// it never touches an environment or a log. The whole surface answers off a LIVE zero-user check, so the moment
// the first account exists -- created here or anywhere else -- setup is gone for good.
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes, timingSafeEqual } from 'node:crypto';

// Models
import { NotFoundError, type SetupRequest, UnauthorizedError } from '@fileshed/core';

// Resource Access
import type { Auth } from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import type { UserRA } from '../resource-access/users/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('setup');

// Grouped hex reads well over a shoulder or a terminal copy: 7f3a-c9d2-04b1-88ee.
function generateSetupCode() : string
{
    return (randomBytes(8).toString('hex')
        .match(/.{4}/g) ?? []).join('-');
}

function tokenMatches(expected : string, presented : string) : boolean
{
    const left = Buffer.from(expected);
    const right = Buffer.from(presented);

    return left.length === right.length && timingSafeEqual(left, right);
}

//----------------------------------------------------------------------------------------------------------------------

export interface SetupDeps
{
    auth : Auth;
    handle : DatabaseHandle;
    users : UserRA;
    // The operator-chosen automation token, when the environment provides one; null generates-and-prints instead.
    operatorToken : string | null;
}

export class SetupManager
{
    readonly #auth : Auth;
    readonly #handle : DatabaseHandle;
    readonly #users : UserRA;
    readonly #token : string;
    readonly #fromEnvironment : boolean;

    // Serializes concurrent completion attempts: the second caller waits, then fails the live zero-user check.
    #completing : Promise<void> | null = null;

    constructor(deps : SetupDeps)
    {
        this.#auth = deps.auth;
        this.#handle = deps.handle;
        this.#users = deps.users;
        this.#fromEnvironment = deps.operatorToken !== null;
        this.#token = deps.operatorToken ?? generateSetupCode();
    }

    // The accepted code. Server-internal: announce prints it, and specs prove the gate with it -- it never rides
    // an API response.
    get code() : string
    {
        return this.#token;
    }

    async needsSetup() : Promise<boolean>
    {
        return !await this.#users.anyUserExists();
    }

    // Boot calls this once. Printing is how the generated code reaches the operator; an environment-provided token
    // is deliberately NOT echoed -- it is already in their hands, and logs travel further than environments do.
    async announce(baseUrl : string) : Promise<void>
    {
        if(!await this.needsSetup()) { return; }

        if(this.#fromEnvironment)
        {
            logger.info('First-run setup is open; FILESHED_SETUP_TOKEN gates it.');
            return;
        }

        logger.info(`First-run setup: visit ${ baseUrl }/setup — setup code: ${ this.#token }`);
    }

    async complete(request : SetupRequest) : Promise<{ email : string }>
    {
        // eslint-disable-next-line no-await-in-loop -- serializing rival completions is the point of the wait
        while(this.#completing !== null) { await this.#completing; }

        let release = () : void => { /* assigned synchronously below */ };
        this.#completing = new Promise((resolve) => { release = resolve; });

        try
        {
            if(!await this.needsSetup()) { throw new NotFoundError('Not Found'); }
            if(!tokenMatches(this.#token, request.token))
            {
                throw new UnauthorizedError('The setup code is not right. It is printed in the server log.');
            }

            const created = await this.#auth.api.signUpEmail({
                body: { email: request.email, name: request.name, password: request.password },
            });

            await this.#handle.db
                .updateTable('user')
                .set({ role: 'admin' })
                .where('id', '=', created.user.id)
                .execute();

            logger.info({ email: created.user.email }, 'First-run setup complete; admin created');

            return { email: created.user.email };
        }
        finally
        {
            release();
            this.#completing = null;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
