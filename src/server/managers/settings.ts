//----------------------------------------------------------------------------------------------------------------------
// Settings Manager
//
// A key resolves as override-over-config: the loaded, substituted yaml is the default, a DB row beats it, and deleting
// the row resets to the default. Secret values are sealed through the SecretBox before they touch a row and masked on
// the way out, so a stored secret never crosses the wire again. Consumers read through value() at use time, which is
// what makes a changed cap apply to the very next request; only requiresRestart keys, frozen into the auth instance at
// boot, wait.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type AdminSettingEntry,
    type AdminSettingKey,
    BadRequestError,
    DEFAULT_INSTANCE_NAME,
    type PatchSettingsRequest,
    type SettingValue,
    adminSettingKeys,
    isOneOf,
    settingDefinitions,
} from '@fileshed/core';

// Engines
import { assertAdmin } from '../engines/adminAccess.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { SettingsRA } from '../resource-access/settings/index.ts';

// Utils
import type { Config } from '../utils/config.ts';
import { getLogger } from '../utils/logger.ts';
import type { SecretBox } from '../utils/secretBox.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('settings');

const MASK_TAIL = 4;

function maskSecret(value : string) : string
{
    return `••••${ value.slice(-MASK_TAIL) }`;
}

export interface SettingsManagerDeps
{
    handle : DatabaseHandle;
    config : Config;
    box : SecretBox;
    started : Date;
}

//----------------------------------------------------------------------------------------------------------------------

export class SettingsManager
{
    readonly #ra : SettingsRA;
    readonly #config : Config;
    readonly #box : SecretBox;
    readonly #started : Date;

    constructor(deps : SettingsManagerDeps)
    {
        this.#ra = new SettingsRA(deps.handle);
        this.#config = deps.config;
        this.#box = deps.box;
        this.#started = deps.started;
    }

    // The config-side default for a key: the loaded yaml value when the key has a config twin, else the
    // vocabulary's own fallback. Null means genuinely unset either way.
    #defaultFor(key : AdminSettingKey) : SettingValue | null
    {
        const definition = settingDefinitions[key];
        const fromConfig = (this.#config as Record<string, unknown>)[key];

        if(fromConfig !== undefined && fromConfig !== null) { return fromConfig as SettingValue; }

        return definition.fallback;
    }

    #decode(key : AdminSettingKey, stored : unknown) : SettingValue | null
    {
        const definition = settingDefinitions[key];

        if(definition.secret && typeof stored === 'string')
        {
            // An unopenable secret (tampered row, rotated AUTH_SECRET) reads as unset: the operator re-enters it.
            return this.#box.open(stored);
        }

        return stored as SettingValue | null;
    }

    // The effective value, override-over-default. Consumers call this at use time.
    async value(key : AdminSettingKey) : Promise<SettingValue | null>
    {
        const stored = await this.#ra.get(key);
        if(stored !== undefined) { return this.#decode(key, stored); }

        return this.#defaultFor(key);
    }

    async numberValue(key : AdminSettingKey, fallback : number) : Promise<number>
    {
        const value = await this.value(key);
        return typeof value === 'number' ? value : fallback;
    }

    async booleanValue(key : AdminSettingKey, fallback : boolean) : Promise<boolean>
    {
        const value = await this.value(key);
        return typeof value === 'boolean' ? value : fallback;
    }

    async stringValue(key : AdminSettingKey, fallback : string) : Promise<string>
    {
        const value = await this.value(key);
        return typeof value === 'string' ? value : fallback;
    }

    async optionalStringValue(key : AdminSettingKey, fallback : string | null) : Promise<string | null>
    {
        const value = await this.value(key);
        return typeof value === 'string' && value !== '' ? value : fallback;
    }

    // A name cleared to blank answers the stock one, so no page title or From line ever names nothing.
    async instanceName() : Promise<string>
    {
        const name = await this.value('INSTANCE_NAME');
        return typeof name === 'string' && name !== '' ? name : DEFAULT_INSTANCE_NAME;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Admin surface
    //------------------------------------------------------------------------------------------------------------------

    // The vocabulary's per-key bounds, enforced before a value can reach a row. A cap outside its bounds is not a
    // value to store and work around later -- an UPLOAD_MAX_BYTES of 0 would refuse every upload, an SMTP_PORT of
    // 70000 can never be dialed -- so it dies here, naming its key, rather than collapsing somewhere downstream.
    #assertWithinConstraints(key : AdminSettingKey, value : SettingValue) : void
    {
        const constraints = settingDefinitions[key].constraints;
        if(constraints === undefined) { return; }

        if(typeof value === 'number')
        {
            if(constraints.min !== undefined && value < constraints.min)
            {
                throw new BadRequestError(`${ key } must be at least ${ constraints.min }.`);
            }

            if(constraints.max !== undefined && value > constraints.max)
            {
                throw new BadRequestError(`${ key } must be at most ${ constraints.max }.`);
            }
        }

        if(typeof value === 'string' && constraints.maxLength !== undefined && value.length > constraints.maxLength)
        {
            throw new BadRequestError(`${ key } must be at most ${ constraints.maxLength } characters.`);
        }
    }

    async adminView(user : SessionUser) : Promise<{ settings : AdminSettingEntry[]; restartRequired : boolean }>
    {
        assertAdmin(user);

        const rows = await this.#ra.all();
        const overrides = new Map(rows.map((row) => [ row.key, row ]));

        const settings = adminSettingKeys.map((key) : AdminSettingEntry =>
        {
            const definition = settingDefinitions[key];
            const override = overrides.get(key);
            const value = override !== undefined ? this.#decode(key, override.value) : this.#defaultFor(key);

            return {
                key,
                kind: definition.kind,
                secret: definition.secret,
                requiresRestart: definition.requiresRestart,
                value: definition.secret && typeof value === 'string' ? maskSecret(value) : value,
                source: override !== undefined ? 'override' : 'default',
                hasDefault: this.#defaultFor(key) !== null,
                constraints: definition.constraints,
            };
        });

        // A stored row can carry a key this version no longer defines.
        const restartRequired = rows.some((row) => isOneOf(adminSettingKeys, row.key)
            && settingDefinitions[row.key].requiresRestart === true
            && row.updated > this.#started);

        return { settings, restartRequired };
    }

    // What a change stores for its key, or null when the change is a reset. Throws the 400 for a value the key refuses.
    #storedFor(key : AdminSettingKey, value : SettingValue | null) : SettingValue | null
    {
        const definition = settingDefinitions[key];

        // Writing the default value IS a reset: storing an override that equals what lies beneath it would make the
        // key read as Overridden while being indistinguishable from default.
        if(value === null || value === this.#defaultFor(key)) { return null; }

        if(typeof value !== definition.kind) { throw new BadRequestError(`${ key } must be a ${ definition.kind }.`); }

        // Every number key is a cap or a day count; a negative or fractional value corrupts the comparisons built on
        // it (a negative retention would put the purge cutoff in the future and eat all of trash).
        if(typeof value === 'number' && (!Number.isInteger(value) || value < 0))
        {
            throw new BadRequestError(`${ key } must be a non-negative integer.`);
        }

        this.#assertWithinConstraints(key, value);

        return definition.secret && typeof value === 'string' ? this.#box.seal(value) : value;
    }

    async patch(user : SessionUser, request : PatchSettingsRequest)
    : Promise<{ settings : AdminSettingEntry[]; restartRequired : boolean }>
    {
        assertAdmin(user);

        // Every change is judged before any is written, so a refused patch stores nothing.
        const writes = (Object.entries(request.changes) as [ AdminSettingKey, SettingValue | null ][])
            .map(([ key, value ]) => ({ key, stored: this.#storedFor(key, value) }));

        for(const { key, stored } of writes)
        {
            // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
            await (stored === null ? this.#ra.remove(key) : this.#ra.upsert(key, stored));
        }

        // Key names only: a secret's value is not a thing to put in a log, sealed or not.
        logger.info({ userID: user.id, keys: Object.keys(request.changes) }, 'Admin changed instance settings');

        return this.adminView(user);
    }
}

//----------------------------------------------------------------------------------------------------------------------
