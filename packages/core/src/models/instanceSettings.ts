//----------------------------------------------------------------------------------------------------------------------
// Instance Settings Vocabulary
//
// The admin-tunable knobs and the facts the UI needs to render them honestly. Most settings are read at use time,
// so a saved change simply applies -- but better-auth freezes some options (OAuth providers) at construction, and
// those carry requiresRestart so the UI can say "saved, takes effect after a restart" instead of lying. A key
// marked secret is stored encrypted and never leaves the server unmasked. Keys shared with the yaml config use the
// SAME name, so an override reads as "this value, instead of the config's"; settings-only keys carry their default
// here.
//----------------------------------------------------------------------------------------------------------------------

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
    kind : SettingKind;
    secret : boolean;

    // True only for keys frozen into the auth instance at construction: saving works, but the value takes effect
    // after a restart. Everything else is read at use time and simply applies.
    requiresRestart : boolean;

    // The default for settings-only keys (no yaml/config twin); null means the config supplies the default.
    fallback : number | boolean | string | null;
}

export const settingDefinitions : Readonly<Record<AdminSettingKey, SettingDefinition>> = {
    UPLOAD_MAX_BYTES:
        { key: 'UPLOAD_MAX_BYTES', kind: 'number', secret: false, requiresRestart: false, fallback: null },
    AVATAR_MAX_BYTES:
        { key: 'AVATAR_MAX_BYTES', kind: 'number', secret: false, requiresRestart: false, fallback: null },
    TRASH_PURGE_DAYS:
        { key: 'TRASH_PURGE_DAYS', kind: 'number', secret: false, requiresRestart: false, fallback: null },
    SIGN_UP_ENABLED:
        { key: 'SIGN_UP_ENABLED', kind: 'boolean', secret: false, requiresRestart: false, fallback: true },
};

export type SettingValue = number | boolean | string;

//----------------------------------------------------------------------------------------------------------------------
