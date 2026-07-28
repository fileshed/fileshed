//----------------------------------------------------------------------------------------------------------------------
// Secret Box
//
// Encryption-at-rest for instance secrets (SMTP passwords, OAuth client secrets). The key derives from AUTH_SECRET
// via HKDF with a purpose label -- never the raw secret, so this use can't collide with anything else derived from
// it -- and the cipher is AES-256-GCM: authenticated, so a tampered row fails closed instead of decrypting to
// garbage. What this defends is the DATABASE'S COPIES (backups, dumps, SQL-level reads) traveling without the
// environment; it defends nothing against a compromised host, and nothing server-side can. Rotating AUTH_SECRET
// makes stored secrets undecryptable by design -- the operator re-enters them, the same rotation that already signs
// every user out. The `v1:` prefix exists so a future scheme can coexist during a migration.
//----------------------------------------------------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

//----------------------------------------------------------------------------------------------------------------------

const VERSION_PREFIX = 'v1:';
const KEY_PURPOSE = 'fileshed:instance-secrets';
const NONCE_BYTES = 12;

export class SecretBox
{
    readonly #key : Buffer;

    constructor(authSecret : string)
    {
        this.#key = Buffer.from(hkdfSync('sha256', Buffer.from(authSecret), Buffer.alloc(0), KEY_PURPOSE, 32));
    }

    seal(plaintext : string) : string
    {
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
        const encrypted = Buffer.concat([ cipher.update(plaintext, 'utf8'), cipher.final() ]);

        return VERSION_PREFIX
            + Buffer.concat([ nonce, cipher.getAuthTag(), encrypted ]).toString('base64');
    }

    // Null on ANY failure -- unknown version, tampered ciphertext, or a rotated AUTH_SECRET -- so a caller treats
    // an unopenable secret as "re-enter it", never as a crash or as silently-wrong bytes.
    open(sealed : string) : string | null
    {
        if(!sealed.startsWith(VERSION_PREFIX)) { return null; }

        try
        {
            const raw = Buffer.from(sealed.slice(VERSION_PREFIX.length), 'base64');
            const nonce = raw.subarray(0, NONCE_BYTES);
            const tag = raw.subarray(NONCE_BYTES, NONCE_BYTES + 16);
            const encrypted = raw.subarray(NONCE_BYTES + 16);

            const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce);
            decipher.setAuthTag(tag);

            return Buffer.concat([ decipher.update(encrypted), decipher.final() ]).toString('utf8');
        }
        catch
        {
            return null;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
