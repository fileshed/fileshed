//----------------------------------------------------------------------------------------------------------------------
// Instance Settings Vocabulary
//
// The admin-tunable knobs and the facts the UI needs to render them honestly. Most settings are read at use time,
// so a saved change simply applies -- but better-auth freezes some options (OAuth providers, required email
// verification) at construction, and those carry requiresRestart so the UI can say "saved, takes effect after a
// restart" instead of lying. A key marked secret is stored encrypted and never leaves the server unmasked. Keys
// shared with the yaml config use the SAME name, so an override reads as "this value, instead of the config's";
// settings-only keys carry their default here.
//----------------------------------------------------------------------------------------------------------------------

// Constants
import { INSTANCE_NAME_MAX_LENGTH } from '../constants/branding.ts';
import { DEFAULT_SMTP_PORT } from '../constants/config.ts';
import { UNLIMITED_QUOTA } from '../constants/quota.ts';

//----------------------------------------------------------------------------------------------------------------------

export const settingKinds = [ 'number', 'boolean', 'string' ] as const;
export type SettingKind = typeof settingKinds[number];

//----------------------------------------------------------------------------------------------------------------------
// Social providers
//----------------------------------------------------------------------------------------------------------------------

// A verbatim mirror of better-auth's socialProviderList -- FileShed offers whatever better-auth supports, and
// curates nothing. Core cannot import better-auth (this vocabulary is shared with the client), so a server spec
// pins this array against the installed library's own list: a bump that changes the set fails the build's tests
// instead of silently drifting.
export const socialProviderIDs = [
    'apple',
    'atlassian',
    'cognito',
    'discord',
    'facebook',
    'figma',
    'github',
    'microsoft',
    'google',
    'huggingface',
    'slack',
    'spotify',
    'twitch',
    'twitter',
    'dropbox',
    'kick',
    'linear',
    'linkedin',
    'gitlab',
    'tiktok',
    'reddit',
    'roblox',
    'salesforce',
    'vk',
    'zoom',
    'notion',
    'kakao',
    'naver',
    'line',
    'paybin',
    'paypal',
    'polar',
    'railway',
    'vercel',
    'wechat',
] as const;
export type SocialProviderID = typeof socialProviderIDs[number];

// Every provider gets a credential pair, named mechanically from its id.
export type ProviderCredentialKey = `${ Uppercase<SocialProviderID> }_CLIENT_ID`
    | `${ Uppercase<SocialProviderID> }_CLIENT_SECRET`;

export function providerCredentialKeys(provider : SocialProviderID)
: { clientID : ProviderCredentialKey; clientSecret : ProviderCredentialKey }
{
    const upper = provider.toUpperCase() as Uppercase<SocialProviderID>;

    return { clientID: `${ upper }_CLIENT_ID`, clientSecret: `${ upper }_CLIENT_SECRET` };
}

// The handful of providers whose OAuth shape wants more than a credential pair. These exist because the provider
// genuinely requires or meaningfully uses them -- not as a place to mirror every optional upstream knob.
export const providerExtraKeys = [
    'APPLE_APP_BUNDLE_IDENTIFIER',
    'COGNITO_DOMAIN',
    'COGNITO_REGION',
    'COGNITO_USER_POOL_ID',
    'GITLAB_ISSUER',
    'MICROSOFT_TENANT_ID',
    'TIKTOK_CLIENT_KEY',
] as const;
export type ProviderExtraKey = typeof providerExtraKeys[number];

export type ProviderSettingKey = ProviderCredentialKey | ProviderExtraKey;

export const providerSettingKeys : readonly ProviderSettingKey[] = [
    ...socialProviderIDs.flatMap((provider) =>
    {
        const keys = providerCredentialKeys(provider);
        return [ keys.clientID, keys.clientSecret ];
    }),
    ...providerExtraKeys,
];

// The setting keys that must hold values before a provider activates at boot. The default is the credential pair;
// the exceptions follow their provider's own contract (Cognito cannot function without its pool coordinates, and
// TikTok authenticates with a client key instead of a client id).
export function providerRequiredKeys(provider : SocialProviderID) : readonly ProviderSettingKey[]
{
    switch (provider)
    {
        case 'cognito':
            return [
                'COGNITO_CLIENT_ID',
                'COGNITO_CLIENT_SECRET',
                'COGNITO_DOMAIN',
                'COGNITO_REGION',
                'COGNITO_USER_POOL_ID',
            ];
        case 'tiktok':
            return [ 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET' ];
        default:
        {
            const keys = providerCredentialKeys(provider);
            return [ keys.clientID, keys.clientSecret ];
        }
    }
}

// Every setting key a provider owns -- its credential pair plus any extras carrying its prefix. This is the
// removal set: deleting a provider's stored configuration means resetting exactly these keys. The trailing
// underscore keeps prefix-sharing ids apart: LINE_ never matches LINEAR_*.
export function providerOwnedKeys(provider : SocialProviderID) : readonly ProviderSettingKey[]
{
    const prefix = `${ provider.toUpperCase() }_`;

    return providerSettingKeys.filter((key) => key.startsWith(prefix));
}

//----------------------------------------------------------------------------------------------------------------------
// The vocabulary
//----------------------------------------------------------------------------------------------------------------------

const staticSettingKeys = [
    'INSTANCE_NAME',
    'UPLOAD_MAX_BYTES',
    'AVATAR_MAX_BYTES',
    'DEFAULT_QUOTA_BYTES',
    'TRASH_PURGE_DAYS',
    'GC_GRACE_DAYS',
    'SIGN_UP_ENABLED',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
    'EMAIL_VERIFICATION_REQUIRED',
] as const;

export type AdminSettingKey = typeof staticSettingKeys[number] | ProviderSettingKey;

export const adminSettingKeys : readonly AdminSettingKey[] = [ ...staticSettingKeys, ...providerSettingKeys ];

// The per-key bounds a value must satisfy to be stored at all. min/max bound a number key, maxLength bounds a
// string key's length; an absent bound imposes nothing. These ride out to the admin UI so a field can hint and
// pre-validate, but the server enforces them independently -- a client hint is a courtesy, never the gate.
export interface SettingConstraints
{
    min ?: number;
    max ?: number;
    maxLength ?: number;
}

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

    // Absent where the generic floor (kind match, non-negative whole numbers) is the whole rule.
    constraints ?: SettingConstraints;
}

// Every provider key shares one shape: a restart-tier string whose secrecy follows its name -- client secrets are
// secrets, everything else (ids, domains, tenants) is a public identifier.
const providerDefinitions = Object.fromEntries(providerSettingKeys.map((key) => [ key, {
    key,
    kind: 'string',
    secret: key.endsWith('_CLIENT_SECRET'),
    requiresRestart: true,
    fallback: null,
} satisfies SettingDefinition ])) as Record<ProviderSettingKey, SettingDefinition>;

export const settingDefinitions : Readonly<Record<AdminSettingKey, SettingDefinition>> = {
    // The instance's display name: page titles, the sidebar wordmark, outgoing email. Settings-only, no config
    // twin -- a deployment brands through the admin surface, not the environment.
    INSTANCE_NAME: {
        key: 'INSTANCE_NAME',
        kind: 'string',
        secret: false,
        requiresRestart: false,
        fallback: 'FileShed',
        constraints: { maxLength: INSTANCE_NAME_MAX_LENGTH },
    },

    // A cap of zero bytes would refuse every upload outright; the floor keeps a mistyped cap from bricking the
    // instance in a way only another admin visit can undo.
    UPLOAD_MAX_BYTES: {
        key: 'UPLOAD_MAX_BYTES',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        fallback: null,
        constraints: { min: 1 },
    },
    AVATAR_MAX_BYTES: {
        key: 'AVATAR_MAX_BYTES',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        fallback: null,
        constraints: { min: 1 },
    },

    // The quota every account with no per-user limit of its own inherits. Zero is unlimited, which is what ships.
    DEFAULT_QUOTA_BYTES: {
        key: 'DEFAULT_QUOTA_BYTES',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        fallback: UNLIMITED_QUOTA,
        constraints: { min: 0 },
    },

    TRASH_PURGE_DAYS: {
        key: 'TRASH_PURGE_DAYS',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        fallback: null,
        constraints: { min: 0 },
    },

    // The graveyard window before a dereferenced blob's bytes go, and the same window a deletion offer stays
    // materializable for. The sweep and the offer minter both read it live.
    GC_GRACE_DAYS: {
        key: 'GC_GRACE_DAYS',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        fallback: null,
        constraints: { min: 0 },
    },

    SIGN_UP_ENABLED:
        { key: 'SIGN_UP_ENABLED', kind: 'boolean', secret: false, requiresRestart: false, fallback: true },

    // Mail is read at send time (the auth callbacks and the test-send build the transport per send), so every SMTP
    // knob applies to the next email without a restart. An unset SMTP_HOST or SMTP_FROM means mail is off.
    SMTP_HOST:
        { key: 'SMTP_HOST', kind: 'string', secret: false, requiresRestart: false, fallback: null },
    SMTP_PORT: {
        key: 'SMTP_PORT',
        kind: 'number',
        secret: false,
        requiresRestart: false,
        fallback: DEFAULT_SMTP_PORT,
        constraints: { min: 1, max: 65_535 },
    },
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

    ...providerDefinitions,
};

export type SettingValue = number | boolean | string;

//----------------------------------------------------------------------------------------------------------------------
