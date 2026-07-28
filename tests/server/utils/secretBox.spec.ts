//----------------------------------------------------------------------------------------------------------------------
// Secret Box — encryption-at-rest for instance secrets
//
// The contract: a sealed value round-trips only through a box holding the same AUTH_SECRET, and open() answers null
// on ANY failure -- tampering, a rotated secret, an unknown scheme -- never garbage bytes and never a throw. Null is
// how "re-enter this secret" reaches the operator.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Utils
import { SecretBox } from '@server/utils/secretBox.ts';

//----------------------------------------------------------------------------------------------------------------------

const SECRET = 'test-auth-secret-test-auth-secret-test';

//----------------------------------------------------------------------------------------------------------------------

describe('SecretBox', () =>
{
    it('round-trips a sealed value back to its plaintext', () =>
    {
        const box = new SecretBox(SECRET);

        const sealed = box.seal('smtp-password-hunter2');

        expect(sealed).not.toContain('smtp-password-hunter2');
        expect(box.open(sealed)).toBe('smtp-password-hunter2');
    });

    it('seals the same plaintext to different ciphertexts, so equal secrets are not linkable at rest', () =>
    {
        const box = new SecretBox(SECRET);

        expect(box.seal('same-secret')).not.toBe(box.seal('same-secret'));
    });

    it('opens tampered ciphertext to null, not to garbage bytes', () =>
    {
        const box = new SecretBox(SECRET);
        const sealed = box.seal('smtp-password-hunter2');

        // Flip a character deep in the base64 body, past the nonce, so the payload itself is what changed.
        const at = sealed.length - 2;
        const flipped = sealed.slice(0, at) + (sealed[at] === 'A' ? 'B' : 'A') + sealed.slice(at + 1);

        expect(box.open(flipped)).toBeNull();
    });

    it('opens to null under a rotated AUTH_SECRET', () =>
    {
        const sealed = new SecretBox(SECRET).seal('smtp-password-hunter2');

        expect(new SecretBox('a-completely-different-secret-entirely').open(sealed)).toBeNull();
    });

    it('opens a value from an unknown scheme to null', () =>
    {
        const box = new SecretBox(SECRET);

        expect(box.open('v2:AAAA')).toBeNull();
        expect(box.open('not sealed at all')).toBeNull();
        expect(box.open('')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
