//----------------------------------------------------------------------------------------------------------------------
// Settings Manager
//
// The instance-settings brain: resolves each admin-tunable key as override-over-config (the loaded, substituted
// yaml IS the default; a DB row beats it; deleting the row is "reset to default"), enforces the vocabulary's
// per-key kind and bounds, seals secret values through the SecretBox before they touch a row, and masks them on the way
// out -- a stored secret never crosses the wire again. Admin-only at this boundary, the same single-condition RBAC
// the admin manager uses. Consumers read through value() at use time, which is what makes a changed cap apply to
// the very next request; only requiresRestart keys (frozen into the auth instance at boot) wait.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    type AdminSettingEntry,
    type AdminSettingKey,
    BadRequestError,
    ForbiddenError,
    type PatchSettingsRequest,
    type SettingValue,
    adminSettingKeys,
    settingDefinitions,
} from '@fileshed/core';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { SettingsRA } from '../resource-access/settings/index.ts';

// Utils
import type { Config } from '../utils/config.ts';
import type { SecretBox } from '../utils/secretBox.ts';

//----------------------------------------------------------------------------------------------------------------------

const MASK_TAIL = 4;

function maskSecret(value : string) : string
{
    return `••••${ value.slice(-MASK_TAIL) }`;
}

export interface SettingsDeps
{
    settings : SettingsRA;
    config : Config;
    box : SecretBox;
    startedAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------

export class SettingsManager
{
    readonly #ra : SettingsRA;
    readonly #config : Config;
    readonly #box : SecretBox;
    readonly #startedAt : Date;

    constructor(deps : SettingsDeps)
    {
        this.#ra = deps.settings;
        this.#config = deps.config;
        this.#box = deps.box;
        this.#startedAt = deps.startedAt;
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

    // The boot-time reads for values better-auth freezes at construction: they run BEFORE the migrations, so on a
    // first boot the settings table may not exist yet -- an unreadable store answers the fallback instead of
    // failing the boot. Restart-tier settings tolerate this by definition: whatever was stored applies next boot.
    async booleanValueAtBoot(key : AdminSettingKey, fallback : boolean) : Promise<boolean>
    {
        try
        {
            return await this.booleanValue(key, fallback);
        }
        catch
        {
            return fallback;
        }
    }

    async stringValueAtBoot(key : AdminSettingKey, fallback : string | null) : Promise<string | null>
    {
        try
        {
            const value = await this.value(key);
            return typeof value === 'string' && value !== '' ? value : fallback;
        }
        catch
        {
            return fallback;
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Admin surface
    //------------------------------------------------------------------------------------------------------------------

    #requireAdmin(actor : SessionUser) : void
    {
        if(actor.role !== 'admin') { throw new ForbiddenError('Admin access required.'); }
    }

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

    async adminView(actor : SessionUser) : Promise<{ settings : AdminSettingEntry[]; restartRequired : boolean }>
    {
        this.#requireAdmin(actor);

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

        const restartRequired = rows.some((row) =>
        {
            const definition = settingDefinitions[row.key as AdminSettingKey];
            return definition?.requiresRestart === true && row.updatedAt > this.#startedAt;
        });

        return { settings, restartRequired };
    }

    async patch(actor : SessionUser, request : PatchSettingsRequest)
    : Promise<{ settings : AdminSettingEntry[]; restartRequired : boolean }>
    {
        this.#requireAdmin(actor);

        for(const [ key, value ] of Object.entries(request.changes) as [ AdminSettingKey, SettingValue | null ][])
        {
            const definition = settingDefinitions[key];

            // Writing the default value IS a reset: storing an override that equals what lies beneath it would
            // make the key read as Overridden while being indistinguishable from default.
            if(value === null || value === this.#defaultFor(key))
            {
                // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
                await this.#ra.remove(key);
            }
            else if(typeof value !== definition.kind)
            {
                throw new BadRequestError(`${ key } must be a ${ definition.kind }.`);
            }
            // Every number key is a cap or a day count; a negative or fractional value corrupts the comparisons
            // built on it (a negative retention would put the purge cutoff in the future and eat all of trash).
            else if(typeof value === 'number' && (!Number.isInteger(value) || value < 0))
            {
                throw new BadRequestError(`${ key } must be a non-negative integer.`);
            }
            else
            {
                this.#assertWithinConstraints(key, value);

                const stored = definition.secret && typeof value === 'string' ? this.#box.seal(value) : value;
                // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
                await this.#ra.upsert(key, stored);
            }
        }

        return this.adminView(actor);
    }
}

//----------------------------------------------------------------------------------------------------------------------
