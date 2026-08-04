//----------------------------------------------------------------------------------------------------------------------
// Auth Secret Engine
//
// Which key signs this boot's sessions, which older keys may still be needed to open what an earlier boot sealed,
// and what to do about a sealed setting none of them opens. Pure: reading, writing and deleting are the manager's.
//
// The ladder, highest first: a file the operator named, then AUTH_SECRET, then the file FileShed manages itself.
// Generation happens only at the bottom of it.
//
// The standing invariant, which judgeSealedSettings encodes: sealed settings are cleared only when
// FILESHED_DISCARD_SEALED_SECRETS says so. Everywhere else, a value no key opens ends the boot.
//----------------------------------------------------------------------------------------------------------------------

export const authSecretSources = [ 'explicit-file', 'environment', 'managed-file', 'generated' ] as const;
export type AuthSecretSource = typeof authSecretSources[number];

export interface AuthSecretFacts
{
    // The value read from an operator-named AUTH_SECRET_FILE. A missing one never reaches here -- that boot ends
    // before the decision, since FileShed will not invent a file the operator said to use.
    explicitFile : string | null;

    environment : string | null;

    // AUTH_SECRET_PREVIOUS: an opening key only, never a signing one.
    previous : string | null;

    // The value at the path FileShed manages, when that file exists.
    managedFile : string | null;
}

export interface AuthSecretDecision
{
    source : AuthSecretSource;

    // Null at 'generated', where the manager mints the value.
    secret : string | null;

    // Keys to try, newest first, against a stored setting the active key cannot open.
    openWith : string[];

    // Custody has moved to a source the operator controls, so the managed file goes -- after anything sealed under
    // it has been re-sealed. Leaving it would keep a copy of a retired key next to the data it no longer protects.
    removeManagedFile : boolean;
}

//----------------------------------------------------------------------------------------------------------------------

export interface SealedSettingsFacts
{
    // True when at least one stored setting opens under none of this boot's keys.
    unopenableSettings : boolean;

    // Where the signing key came from. 'generated' means this boot had none to start with, which is a different
    // situation for the operator than a key that is simply not the one those settings were sealed under.
    source : AuthSecretSource;

    discardSealedSecrets : boolean;
}

export const sealedSettingsVerdicts = [ 'proceed', 'clear', 'refuse-without-key', 'refuse-after-rotation' ] as const;
export type SealedSettingsVerdict = typeof sealedSettingsVerdicts[number];

// Deleting a value nobody asked to delete is not a recovery, it is a second failure on top of the first. A key can
// usually still be produced -- from a secret store, a backup, the operator's memory -- so an unopenable setting
// ends the boot and says how to finish the rotation, unless the operator has already said to let them go.
export function judgeSealedSettings(facts : SealedSettingsFacts) : SealedSettingsVerdict
{
    if(!facts.unopenableSettings) { return 'proceed'; }

    if(facts.discardSealedSecrets) { return 'clear'; }

    return facts.source === 'generated' ? 'refuse-without-key' : 'refuse-after-rotation';
}

//----------------------------------------------------------------------------------------------------------------------

// The opening keys, in the order they are tried: newest first, the active key dropped (it is tried before these),
// duplicates dropped (two sources holding the same value is custody, not history).
function openingKeys(active : string | null, older : (string | null)[]) : string[]
{
    const keys : string[] = [];

    for(const key of older)
    {
        if(key !== null && key !== active && !keys.includes(key)) { keys.push(key); }
    }

    return keys;
}

//----------------------------------------------------------------------------------------------------------------------

export function decideAuthSecret(facts : AuthSecretFacts) : AuthSecretDecision
{
    if(facts.explicitFile !== null)
    {
        return {
            source: 'explicit-file',
            secret: facts.explicitFile,
            openWith: openingKeys(facts.explicitFile, [ facts.environment, facts.managedFile, facts.previous ]),
            removeManagedFile: facts.managedFile !== null,
        };
    }

    if(facts.environment !== null)
    {
        return {
            source: 'environment',
            secret: facts.environment,
            openWith: openingKeys(facts.environment, [ facts.managedFile, facts.previous ]),
            removeManagedFile: facts.managedFile !== null,
        };
    }

    if(facts.managedFile !== null)
    {
        return {
            source: 'managed-file',
            secret: facts.managedFile,
            openWith: openingKeys(facts.managedFile, [ facts.previous ]),
            removeManagedFile: false,
        };
    }

    // Nothing to sign with: the manager mints one. Whether that is safe depends on what the database holds, which
    // judgeSealedSettings answers once the manager has tried every key it has against every sealed value.
    return {
        source: 'generated',
        secret: null,
        openWith: openingKeys(null, [ facts.previous ]),
        removeManagedFile: false,
    };
}

//----------------------------------------------------------------------------------------------------------------------
