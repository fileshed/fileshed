//----------------------------------------------------------------------------------------------------------------------
// Auth Secret Engine — the precedence ladder
//
// The contract: a file the operator named beats AUTH_SECRET, which beats the file FileShed manages, and only the
// bottom rung generates. Whichever key wins, the keys it displaces stay available to open what they sealed.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { type AuthSecretFacts, decideAuthSecret, judgeSealedSettings } from '@server/engines/authSecret.ts';

//----------------------------------------------------------------------------------------------------------------------

const EXPLICIT = 'secret-from-the-mounted-file-0123456789';
const ENVIRONMENT = 'secret-from-the-environment-0123456789';
const MANAGED = 'secret-from-the-managed-file-0123456789';
const PREVIOUS = 'secret-from-the-last-rotation-012345678';

function facts(overrides : Partial<AuthSecretFacts> = {}) : AuthSecretFacts
{
    return {
        explicitFile: null,
        environment: null,
        previous: null,
        managedFile: null,
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('decideAuthSecret', () =>
{
    it('signs with the operator-named file over everything else', () =>
    {
        const decision = decideAuthSecret(facts({
            explicitFile: EXPLICIT,
            environment: ENVIRONMENT,
            managedFile: MANAGED,
        }));

        expect(decision).toMatchObject({ source: 'explicit-file', secret: EXPLICIT });
    });

    it('signs with AUTH_SECRET over the managed file', () =>
    {
        const decision = decideAuthSecret(facts({ environment: ENVIRONMENT, managedFile: MANAGED }));

        expect(decision).toMatchObject({ source: 'environment', secret: ENVIRONMENT });
    });

    it('signs with the managed file when the operator sets neither', () =>
    {
        const decision = decideAuthSecret(facts({ managedFile: MANAGED }));

        expect(decision).toMatchObject({ source: 'managed-file', secret: MANAGED });
    });

    it('generates when no key exists anywhere', () =>
    {
        const decision = decideAuthSecret(facts());

        expect(decision).toMatchObject({ source: 'generated', secret: null });
    });

    // Every key the winner displaced can still be holding a stored setting open, so all of them stay available --
    // newest first, since the most recently retired key is the likeliest to have sealed something.
    it('keeps every displaced key available to open older values, newest first', () =>
    {
        const decision = decideAuthSecret(facts({
            explicitFile: EXPLICIT,
            environment: ENVIRONMENT,
            managedFile: MANAGED,
            previous: PREVIOUS,
        }));

        expect(decision).toMatchObject({ openWith: [ ENVIRONMENT, MANAGED, PREVIOUS ] });
    });

    it('treats two sources holding the same value as custody, not a rotation', () =>
    {
        const decision = decideAuthSecret(facts({ environment: MANAGED, managedFile: MANAGED }));

        expect(decision).toMatchObject({ openWith: [], removeManagedFile: true });
    });

    it('retires the managed file once an operator-controlled source supplies the secret', () =>
    {
        const takenOver = decideAuthSecret(facts({ environment: ENVIRONMENT, managedFile: MANAGED }));
        const untouched = decideAuthSecret(facts({ managedFile: MANAGED }));

        expect(takenOver).toMatchObject({ removeManagedFile: true });
        expect(untouched).toMatchObject({ removeManagedFile: false });
    });

    it('carries the previous key into a generated boot, for what it may still open', () =>
    {
        const decision = decideAuthSecret(facts({ previous: PREVIOUS }));

        expect(decision).toMatchObject({ source: 'generated', secret: null, openWith: [ PREVIOUS ] });
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Settings no key opens
//
// The invariant: sealed settings are cleared only when FILESHED_DISCARD_SEALED_SECRETS says so. Every other boot
// that meets a value no available key opens ends, because the key is usually still recoverable and deleting the
// value is not.
//----------------------------------------------------------------------------------------------------------------------

describe('judgeSealedSettings', () =>
{
    it('proceeds when every sealed setting opens', () =>
    {
        const verdict = judgeSealedSettings({
            unopenableSettings: false,
            source: 'environment',
            discardSealedSecrets: false,
        });

        expect(verdict).toBe('proceed');
    });

    // The product owner's scenario: an intended-lossless rotation where AUTH_SECRET_PREVIOUS was mistyped or
    // forgotten. The old key is usually still in a secret store, so the boot ends and says how to finish.
    it('refuses a rotation whose old key was never supplied, rather than clearing anything', () =>
    {
        const verdict = judgeSealedSettings({
            unopenableSettings: true,
            source: 'environment',
            discardSealedSecrets: false,
        });

        expect(verdict).toBe('refuse-after-rotation');
    });

    it('refuses differently when the boot had no key of its own to begin with', () =>
    {
        const verdict = judgeSealedSettings({
            unopenableSettings: true,
            source: 'generated',
            discardSealedSecrets: false,
        });

        expect(verdict).toBe('refuse-without-key');
    });

    it('clears only when the operator has said to', () =>
    {
        const afterRotation = judgeSealedSettings({
            unopenableSettings: true,
            source: 'environment',
            discardSealedSecrets: true,
        });
        const withoutKey = judgeSealedSettings({
            unopenableSettings: true,
            source: 'generated',
            discardSealedSecrets: true,
        });

        expect(afterRotation).toBe('clear');
        expect(withoutKey).toBe('clear');
    });

    it('does not clear on a discarding boot that had nothing to discard', () =>
    {
        const verdict = judgeSealedSettings({
            unopenableSettings: false,
            source: 'managed-file',
            discardSealedSecrets: true,
        });

        expect(verdict).toBe('proceed');
    });
});

//----------------------------------------------------------------------------------------------------------------------
