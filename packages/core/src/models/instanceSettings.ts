//----------------------------------------------------------------------------------------------------------------------
// Instance Settings Vocabulary
//
// The admin-tunable knobs and the facts the UI needs to render them honestly. Every setting carries its
// APPLICATION TIER -- how a change takes effect -- because better-auth freezes some options at construction:
//   live      applied immediately, read at use time
//   callback  read inside a send-time callback (mail), so changes apply to the next send
//   restart   captured at boot (OAuth routes, timer cadences); the UI flags a restart after edits
// A key marked secret is stored encrypted and never leaves the server unmasked. Keys shared with the yaml config
// use the SAME name, so an override reads as "this value, instead of the config's"; settings-only keys carry their
// default here.
//----------------------------------------------------------------------------------------------------------------------

export const settingTiers = [ 'live', 'callback', 'restart' ] as const;
export type SettingTier = typeof settingTiers[number];

export const settingKinds = [ 'number', 'boolean', 'string' ] as const;
export type SettingKind = typeof settingKinds[number];

export const adminSettingKeys = [
    'UPLOAD_MAX_BYTES',
    'AVATAR_MAX_BYTES',
    'TRASH_PURGE_DAYS',
    'SIGN_UP_ENABLED',
] as const;
export type AdminSettingKey = typeof adminSettingKeys[number];

export interface SettingDefinition
{
    key : AdminSettingKey;
    tier : SettingTier;
    kind : SettingKind;
    secret : boolean;

    // The default for settings-only keys (no yaml/config twin); null means the config supplies the default.
    fallback : number | boolean | string | null;
}

export const settingDefinitions : Readonly<Record<AdminSettingKey, SettingDefinition>> = {
    UPLOAD_MAX_BYTES: { key: 'UPLOAD_MAX_BYTES', tier: 'live', kind: 'number', secret: false, fallback: null },
    AVATAR_MAX_BYTES: { key: 'AVATAR_MAX_BYTES', tier: 'live', kind: 'number', secret: false, fallback: null },
    TRASH_PURGE_DAYS: { key: 'TRASH_PURGE_DAYS', tier: 'live', kind: 'number', secret: false, fallback: null },
    SIGN_UP_ENABLED: { key: 'SIGN_UP_ENABLED', tier: 'live', kind: 'boolean', secret: false, fallback: true },
};

export type SettingValue = number | boolean | string;

//----------------------------------------------------------------------------------------------------------------------
