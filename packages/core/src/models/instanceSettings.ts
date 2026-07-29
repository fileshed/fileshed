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
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
    'EMAIL_VERIFICATION_REQUIRED',
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

    // Mail is read at send time (the auth callbacks and the test-send build the transport per send), so every SMTP
    // knob applies to the next email without a restart. An unset SMTP_HOST or SMTP_FROM means mail is off.
    SMTP_HOST:
        { key: 'SMTP_HOST', kind: 'string', secret: false, requiresRestart: false, fallback: null },
    SMTP_PORT:
        { key: 'SMTP_PORT', kind: 'number', secret: false, requiresRestart: false, fallback: 587 },
    SMTP_SECURE:
        { key: 'SMTP_SECURE', kind: 'boolean', secret: false, requiresRestart: false, fallback: false },
    SMTP_USER:
        { key: 'SMTP_USER', kind: 'string', secret: false, requiresRestart: false, fallback: null },
    SMTP_PASSWORD:
        { key: 'SMTP_PASSWORD', kind: 'string', secret: true, requiresRestart: false, fallback: null },
    SMTP_FROM:
        { key: 'SMTP_FROM', kind: 'string', secret: false, requiresRestart: false, fallback: null },

    // better-auth freezes requireEmailVerification into the instance at construction -- the one mail knob that
    // waits on a restart.
    EMAIL_VERIFICATION_REQUIRED:
        { key: 'EMAIL_VERIFICATION_REQUIRED', kind: 'boolean', secret: false, requiresRestart: true, fallback: false },
};

export type SettingValue = number | boolean | string;

//----------------------------------------------------------------------------------------------------------------------
