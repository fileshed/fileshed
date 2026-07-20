//----------------------------------------------------------------------------------------------------------------------
// Role Codecs -- permission role and the share-grantable subset
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { roleCodec, shareRoleCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('shareRoleCodec', () =>
{
    // shares grant viewer or editor only -- ownership is never conferred by a share.
    it('rejects the owner role', () =>
    {
        expect(shareRoleCodec.safeParse('owner').success).toBe(false);
    });

    it('accepts viewer and editor', () =>
    {
        expect(shareRoleCodec.safeParse('viewer').success).toBe(true);
        expect(shareRoleCodec.safeParse('editor').success).toBe(true);
    });
});

describe('roleCodec', () =>
{
    // owner is a real effective role (via ownership), just not a grantable one.
    it('accepts owner alongside viewer and editor', () =>
    {
        expect(roleCodec.safeParse('owner').success).toBe(true);
        expect(roleCodec.safeParse('viewer').success).toBe(true);
        expect(roleCodec.safeParse('editor').success).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
