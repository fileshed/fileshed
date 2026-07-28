//----------------------------------------------------------------------------------------------------------------------
// Settings Manager
//
// The instance-settings brain: resolves each admin-tunable key as override-over-config (the loaded, substituted
// yaml IS the default; a DB row beats it; deleting the row is "reset to default"), enforces the vocabulary's
// per-key kind, seals secret-tier values through the SecretBox before they touch a row, and masks them on the way
// out -- a stored secret never crosses the wire again. Admin-only at this boundary, the same single-condition RBAC
// the admin manager uses. Live-tier consumers read through value() at use time, which is what makes a changed cap
// apply to the very next request.
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

    // The effective value, override-over-default. Live-tier consumers call this at use time.
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

    //------------------------------------------------------------------------------------------------------------------
    // Admin surface
    //------------------------------------------------------------------------------------------------------------------

    #requireAdmin(actor : SessionUser) : void
    {
        if(actor.role !== 'admin') { throw new ForbiddenError('Admin access required.'); }
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
                tier: definition.tier,
                kind: definition.kind,
                secret: definition.secret,
                value: definition.secret && typeof value === 'string' ? maskSecret(value) : value,
                source: override !== undefined ? 'override' : 'default',
            };
        });

        const restartRequired = rows.some((row) =>
        {
            const definition = settingDefinitions[row.key as AdminSettingKey];
            return definition?.tier === 'restart' && row.updatedAt > this.#startedAt;
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

            if(value === null)
            {
                // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
                await this.#ra.remove(key);
            }
            else if(typeof value !== definition.kind)
            {
                throw new BadRequestError(`${ key } must be a ${ definition.kind }.`);
            }
            else
            {
                const stored = definition.secret && typeof value === 'string' ? this.#box.seal(value) : value;
                // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
                await this.#ra.upsert(key, stored);
            }
        }

        return this.adminView(actor);
    }
}

//----------------------------------------------------------------------------------------------------------------------
