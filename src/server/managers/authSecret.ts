//----------------------------------------------------------------------------------------------------------------------
// Auth Secret Manager
//
// Resolves the key this process signs sessions with, and carries stored settings sealed under an older key across
// to it. The ladder itself is engines/authSecret.ts; this file does the reading, generating, re-sealing and
// deleting, in the order that survives being killed halfway through:
//
//   re-seal first, delete the retired file last. A crash in between leaves both keys reachable, and the next boot
//   judges every value by which key opens it -- so it finishes the job rather than finding it half done.
//
// It runs before the auth instance exists, and so before any migration: on a first boot the settings table is
// simply absent, which reads as "nothing is sealed".
//----------------------------------------------------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

// Models
import {
    AUTH_SECRET_FILE_NAME,
    type AdminSettingKey,
    GENERATED_AUTH_SECRET_BYTES,
    settingDefinitions,
} from '@fileshed/core';

// Engines
import { type AuthSecretSource, decideAuthSecret, judgeSealedSettings } from '../engines/authSecret.ts';

// Resource Access
import {
    createSecretFile,
    describeFileError,
    readSecretFile,
    removeSecretFile,
} from '../resource-access/secrets/index.ts';
import type { SettingsRA } from '../resource-access/settings/index.ts';

// Utils
import type { Config } from '../utils/config.ts';
import { getLogger } from '../utils/logger.ts';
import { resolveDataPath } from '../utils/paths.ts';
import { SecretBox } from '../utils/secretBox.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('auth-secret');

const DOCS = 'See docs/secrets.md.';

// The file FileShed manages for itself: beside the database, in the data directory a deployment already mounts and
// backs up. AUTH_SECRET_FILE pointed at any other path names a file the operator owns.
export function managedAuthSecretFile(config : Config) : string
{
    return join(dirname(config.DATABASE_PATH), AUTH_SECRET_FILE_NAME);
}

export interface AuthSecretDeps
{
    // Where FileShed would keep its own secret, and the path the operator named (null when they named none).
    managedFile : string;
    configuredFile : string | null;

    environment : string | null;
    previous : string | null;
    discardSealedSecrets : boolean;

    settings : SettingsRA;
}

interface SealedSetting
{
    key : AdminSettingKey;
    value : string;
}

// A sealed setting after every available key has been tried against it: already under the active key, opened by an
// older one (and carrying the plaintext to re-seal), or opened by none.
type ScannedSetting
    = { key : AdminSettingKey; state : 'current' }
    | { key : AdminSettingKey; state : 'older'; plain : string }
    | { key : AdminSettingKey; state : 'unopenable' };

interface Migration
{
    resealed : AdminSettingKey[];
    cleared : AdminSettingKey[];
}

//----------------------------------------------------------------------------------------------------------------------

// The settings whose stored value is ciphertext. No table yet means a first boot: nothing has been sealed.
async function sealedSettings(settings : SettingsRA) : Promise<SealedSetting[]>
{
    if(!await settings.tableExists()) { return []; }

    return (await settings.all()).flatMap((row) =>
    {
        const definition = settingDefinitions[row.key as AdminSettingKey];

        return definition?.secret === true && typeof row.value === 'string'
            ? [ { key: definition.key, value: row.value } ]
            : [];
    });
}

function openWithAny(value : string, boxes : SecretBox[]) : string | null
{
    for(const box of boxes)
    {
        const opened = box.open(value);
        if(opened !== null) { return opened; }
    }

    return null;
}

// Every sealed setting against every key this boot has, before a byte is written anywhere: a boot that ends in a
// refusal has to leave the data directory exactly as it found it, which rules out generating first and asking
// afterwards. A setting the active key already opens needs nothing; one an older key opens is re-sealed; one
// nobody opens is the operator's decision, not FileShed's.
function scanSealed(rows : SealedSetting[], active : string | null, older : string[]) : ScannedSetting[]
{
    const activeBox = active === null ? null : new SecretBox(active);
    const olderBoxes = older.map((key) => new SecretBox(key));

    return rows.map((row) : ScannedSetting =>
    {
        if(activeBox !== null && activeBox.open(row.value) !== null) { return { key: row.key, state: 'current' }; }

        const plain = openWithAny(row.value, olderBoxes);

        return plain === null ? { key: row.key, state: 'unopenable' } : { key: row.key, state: 'older', plain };
    });
}

// The writes the scan implies. Clearing happens only when the caller was told it may -- the verdict decides that,
// never this function.
async function applyMigration(
    settings : SettingsRA,
    scanned : ScannedSetting[],
    active : SecretBox,
    clearUnopenable : boolean
) : Promise<Migration>
{
    const stale = scanned.flatMap((row) =>
    {
        return row.state === 'older' ? [ row ] : [];
    });

    const lost = clearUnopenable
        ? scanned.flatMap((row) =>
        {
            return row.state === 'unopenable' ? [ row ] : [];
        })
        : [];

    for(const row of stale)
    {
        // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
        await settings.upsert(row.key, active.seal(row.plain));
    }

    for(const row of lost)
    {
        // eslint-disable-next-line no-await-in-loop -- a handful of keys, applied in order
        await settings.remove(row.key);
    }

    return { resealed: stale.map((row) => row.key), cleared: lost.map((row) => row.key) };
}

//----------------------------------------------------------------------------------------------------------------------

function missingExplicitFile(path : string, managedFile : string, reason : string) : Error
{
    return new Error(`AUTH_SECRET_FILE names '${ path }', which cannot be read (${ reason }). A file you name is `
        + 'yours: FileShed reads it and never creates or replaces it. Put the secret there, or unset '
        + `AUTH_SECRET_FILE to have FileShed manage one at '${ managedFile }'. ${ DOCS }`);
}

// The rotation half of the refusal: this boot has a key, just not the one those settings were sealed with. Almost
// always a rotation that forgot AUTH_SECRET_PREVIOUS, and the value it wants is usually still in the operator's
// secret store -- so the lossless route comes first and the destructive one has to be asked for.
function sealedUnderAnotherKey(keys : AdminSettingKey[]) : Error
{
    return new Error('Stored settings are encrypted with a key other than the one this boot signs with '
        + `(${ keys.join(', ') }). This looks like a rotation without the old key: set AUTH_SECRET_PREVIOUS to the `
        + 'value being replaced and FileShed moves them to the new key on the next boot. To clear them instead, '
        + 'set FILESHED_DISCARD_SEALED_SECRETS=1 for one boot -- the listed settings are cleared and have to be '
        + `re-entered. ${ DOCS }`);
}

function sealedWithoutKey(keys : AdminSettingKey[], managedFile : string) : Error
{
    return new Error('Stored settings are encrypted with a key this boot does not have '
        + `(${ keys.join(', ') }). FileShed keeps that key in '${ managedFile }' unless AUTH_SECRET or `
        + 'AUTH_SECRET_FILE supplies it: restore that file, or set AUTH_SECRET to the value that sealed them '
        + '(adding AUTH_SECRET_PREVIOUS if you are rotating at the same time). To start without them, set '
        + 'FILESHED_DISCARD_SEALED_SECRETS=1 for one boot -- the listed settings are cleared and have to be '
        + `re-entered. ${ DOCS }`);
}

// Read the operator's file, or end the boot naming it. Nothing here writes: the point of an explicit path is that
// a read-only secret mount behaves exactly as mounted.
async function readExplicitFile(path : string, managedFile : string) : Promise<string>
{
    let secret : string | null;

    try { secret = await readSecretFile(path); }
    catch(error) { throw missingExplicitFile(path, managedFile, describeFileError(error)); }

    if(secret === null) { throw missingExplicitFile(path, managedFile, 'ENOENT'); }

    return secret;
}

// Mint a secret at the managed path. Whoever creates the file wins: a process that loses the race reads the
// winner's value, so two starting together sign with one key instead of splitting the instance in half.
async function generate(path : string) : Promise<{ secret : string; created : boolean }>
{
    const created = await createSecretFile(path, randomBytes(GENERATED_AUTH_SECRET_BYTES).toString('base64'));
    const secret = await readSecretFile(path);

    if(secret === null) { throw new Error(`The secret file at '${ path }' disappeared as it was written.`); }

    return { secret, created };
}

//----------------------------------------------------------------------------------------------------------------------

interface BootStory
{
    managedFile : string;
    generated : boolean;
    removedManagedFile : boolean;
    previousSet : boolean;
    migration : Migration;
}

const sourceNames : Record<AuthSecretSource, string> = {
    'explicit-file': 'the file named by AUTH_SECRET_FILE',
    'environment': 'AUTH_SECRET',
    'managed-file': 'the managed secret file',
    'generated': 'the generated secret',
};

// One line for each thing an operator would want to know happened, and nothing at all for the ordinary boot where
// none of it did.
function report(source : AuthSecretSource, story : BootStory) : void
{
    if(story.generated)
    {
        logger.warn(`Generated a session-signing secret at '${ story.managedFile }', readable only by this user. `
            + 'It is reused on every boot and belongs in your backups beside the database. Set AUTH_SECRET or '
            + `AUTH_SECRET_FILE to supply your own instead. ${ DOCS }`);
    }

    if(story.migration.resealed.length > 0)
    {
        logger.warn({ settings: story.migration.resealed }, 'The session secret changed: re-sealed the stored '
            + `settings (${ story.migration.resealed.join(', ') }) under the new key. Everyone signed in has `
            + 'been signed out.');
    }

    if(story.removedManagedFile)
    {
        logger.warn(`Removed the managed secret file at '${ story.managedFile }': ${ sourceNames[source] } `
            + 'supplies the secret now.');
    }

    if(story.migration.cleared.length > 0)
    {
        logger.warn({ settings: story.migration.cleared }, 'Cleared stored settings no available key could open '
            + `(${ story.migration.cleared.join(', ') }). Re-enter them in the admin settings. ${ DOCS }`);
    }

    if(story.previousSet && story.migration.resealed.length === 0)
    {
        logger.warn('AUTH_SECRET_PREVIOUS is set and nothing needed it. Remove it from the environment.');
    }
}

//----------------------------------------------------------------------------------------------------------------------

export async function resolveAuthSecret(deps : AuthSecretDeps) : Promise<string>
{
    const { configuredFile, managedFile, settings } = deps;

    const explicitPath = configuredFile !== null && resolveDataPath(configuredFile) !== resolveDataPath(managedFile)
        ? configuredFile
        : null;

    const explicitFile = explicitPath === null ? null : await readExplicitFile(explicitPath, managedFile);
    const sealed = await sealedSettings(settings);

    const decision = decideAuthSecret({
        explicitFile,
        environment: deps.environment,
        previous: deps.previous,
        managedFile: await readSecretFile(managedFile),
    });

    const scanned = scanSealed(sealed, decision.secret, decision.openWith);
    const unopenable = scanned.flatMap((row) =>
    {
        return row.state === 'unopenable' ? [ row.key ] : [];
    });

    const verdict = judgeSealedSettings({
        unopenableSettings: unopenable.length > 0,
        source: decision.source,
        discardSealedSecrets: deps.discardSealedSecrets,
    });

    if(verdict === 'refuse-without-key') { throw sealedWithoutKey(unopenable, managedFile); }
    if(verdict === 'refuse-after-rotation') { throw sealedUnderAnotherKey(unopenable); }

    let secret = decision.secret;
    let generated = false;

    if(secret === null)
    {
        const minted = await generate(managedFile);
        secret = minted.secret;
        generated = minted.created;
    }

    const migration = await applyMigration(settings, scanned, new SecretBox(secret), verdict === 'clear');

    if(decision.removeManagedFile) { await removeSecretFile(managedFile); }

    report(decision.source, {
        managedFile,
        generated,
        removedManagedFile: decision.removeManagedFile,
        previousSet: deps.previous !== null,
        migration,
    });

    return secret;
}

//----------------------------------------------------------------------------------------------------------------------
