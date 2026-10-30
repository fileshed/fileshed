//----------------------------------------------------------------------------------------------------------------------
// Blob Codec
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { blobCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('blobCodec', () =>
{
    it('parses a referenced blob with a null deleted', () =>
    {
        const blob = {
            sha256: 'a'.repeat(64),
            size: 2048,
            backendID: 'backend_1',
            storageKey: 'ab/cd/abcd',
            created: new Date('2026-01-01T00:00:00.000Z'),
            deleted: null,
        };

        expect(blobCodec.safeParse(blob).success).toBe(true);
    });

    // deleted is the graveyard marker set when the last reference drops.
    it('parses a graveyarded blob with a deleted', () =>
    {
        const blob = {
            sha256: 'b'.repeat(64),
            size: 2048,
            backendID: 'backend_1',
            storageKey: 'bb/cd/bbcd',
            created: new Date('2026-01-01T00:00:00.000Z'),
            deleted: new Date('2026-02-01T00:00:00.000Z'),
        };

        expect(blobCodec.safeParse(blob).success).toBe(true);
    });

    // the ref count is derived, never stored on the blob. A persisted refCount is a wrong-shape field a strict codec
    // must reject rather than absorb.
    it('rejects a blob carrying a stored refCount field', () =>
    {
        const blob = {
            sha256: 'c'.repeat(64),
            size: 2048,
            backendID: 'backend_1',
            storageKey: 'cc/cd/cccd',
            created: new Date('2026-01-01T00:00:00.000Z'),
            deleted: null,
            refCount: 3,
        };

        expect(blobCodec.safeParse(blob).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
