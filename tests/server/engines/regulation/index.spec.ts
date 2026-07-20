//----------------------------------------------------------------------------------------------------------------------
// Regulation Facade -- composition and verdict combination
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Regulation
import { type RegulationResult, regulation } from '@server/engines/regulation/index.ts';

//----------------------------------------------------------------------------------------------------------------------

function codes(result : RegulationResult) : string[]
{
    return result.ok ? [] : result.violations.map((violation) => violation.code);
}

//----------------------------------------------------------------------------------------------------------------------

describe('regulation facade', () =>
{
    // the per-domain engines compose into one regulation layer -- node placement judgements route through the facade.
    it('routes node placement judgements through regulation.node', () =>
    {
        const result = regulation.node.move({ nodeID: 'a', newParentID: 'a', parentAncestorIDs: [] });

        expect(codes(result)).toContain('move.intoSelf');
    });

    // quota admission is part of the same regulation layer.
    it('routes quota admission through regulation.quota', () =>
    {
        const result = regulation.quota.admit({
            ownerID: 'user_owner',
            usedBytes: 10,
            limitBytes: 5,
            incomingBytes: 1,
        });

        expect(codes(result)).toEqual([ 'quota.exceeded' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('regulation.combine', () =>
{
    // a manager gathers facts for one operation and needs a single verdict; combining all-passing judgements passes.
    it('passes when every judgement passes', () =>
    {
        const passing = regulation.quota.admit({
            ownerID: 'user_owner',
            usedBytes: 0,
            limitBytes: 100,
            incomingBytes: 10,
        });

        const result = regulation.combine([ passing, passing ]);

        expect(result.ok).toBe(true);
    });

    // An empty set of judgements has nothing to object to.
    it('passes when there are no judgements to combine', () =>
    {
        const result = regulation.combine([]);

        expect(result.ok).toBe(true);
    });

    // A single failing judgement fails the whole verdict.
    it('fails when any judgement fails', () =>
    {
        const passing = regulation.quota.admit({
            ownerID: 'user_owner',
            usedBytes: 0,
            limitBytes: 100,
            incomingBytes: 10,
        });
        const failing = regulation.node.move({ nodeID: 'a', newParentID: 'a', parentAncestorIDs: [] });

        const result = regulation.combine([ passing, failing ]);

        expect(codes(result)).toEqual([ 'move.intoSelf' ]);
    });

    // Every failure's violations are collected, in the order the judgements were combined.
    it('concatenates violations from every failing judgement in order', () =>
    {
        const quotaFail = regulation.quota.admit({
            ownerID: 'user_owner',
            usedBytes: 10,
            limitBytes: 5,
            incomingBytes: 1,
        });
        const moveFail = regulation.node.move({ nodeID: 'a', newParentID: 'a', parentAncestorIDs: [] });

        const result = regulation.combine([ quotaFail, moveFail ]);

        expect(codes(result)).toEqual([ 'quota.exceeded', 'move.intoSelf' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
