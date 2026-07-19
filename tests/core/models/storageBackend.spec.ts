//----------------------------------------------------------------------------------------------------------------------
// Storage Backend Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { storageBackendCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('storageBackendCodec', () =>
{
    // requirements.md secs 3.1/4.1: config is backend-specific JSON, opaque at this boundary -- any object passes.
    it('parses a backend with an arbitrary config object', () =>
    {
        const backend = {
            id: 'backend_1',
            kind: 's3',
            config: { bucket: 'fileshed', region: 'us-east-1', endpoint: null },
            isDefault: true,
        };

        expect(storageBackendCodec.safeParse(backend).success).toBe(true);
    });

    // requirements.md sec 3.1: kind is one of fs|db|s3|azure.
    it('rejects a backend of an unknown kind', () =>
    {
        const backend = {
            id: 'backend_2',
            kind: 'gcs',
            config: {},
            isDefault: false,
        };

        expect(storageBackendCodec.safeParse(backend).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
