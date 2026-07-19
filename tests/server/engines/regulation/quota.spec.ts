//----------------------------------------------------------------------------------------------------------------------
// Quota Regulation -- admission control
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Regulation
import { judgeQuotaAdmission } from '@server/engines/regulation/quota.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('judgeQuotaAdmission', () =>
{
    // requirements.md sec 5: a write is admitted while used + incoming stays within the limit.
    it('admits a write that stays under the limit', () =>
    {
        const result = judgeQuotaAdmission({
            ownerID: 'user_owner',
            usedBytes: 1000,
            limitBytes: 5000,
            incomingBytes: 2000,
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 5: rejection is only when used + size exceeds the limit -- landing exactly on the limit is
    // admitted.
    it('admits a write that lands exactly on the limit', () =>
    {
        const result = judgeQuotaAdmission({
            ownerID: 'user_owner',
            usedBytes: 4000,
            limitBytes: 5000,
            incomingBytes: 1000,
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 5: reject when used + size exceeds the limit -- one byte over is over.
    it('rejects a write one byte over the limit', () =>
    {
        const result = judgeQuotaAdmission({
            ownerID: 'user_owner',
            usedBytes: 4000,
            limitBytes: 5000,
            incomingBytes: 1001,
        });

        expect(result.ok).toBe(false);
        expect(result.ok ? [] : result.violations.map((violation) => violation.code)).toEqual([ 'quota.exceeded' ]);
    });

    // requirements.md sec 5: a null limit is unlimited and admits any write.
    it('admits any write under an unlimited (null) quota', () =>
    {
        const result = judgeQuotaAdmission({
            ownerID: 'user_owner',
            usedBytes: 9_000_000_000,
            limitBytes: null,
            incomingBytes: 4_000_000_000,
        });

        expect(result.ok).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
