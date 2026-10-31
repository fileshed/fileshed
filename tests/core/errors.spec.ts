//----------------------------------------------------------------------------------------------------------------------
// Shared Error Vocabulary
//
// The error classes are plain and portable; what matters on the wire is their stable `code` strings and the violations
// a RegulationError carries. These assert that contract, not the class plumbing.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    BlobBackendError,
    BlobNotFoundError,
    HashMismatchError,
    InvalidSha256Error,
    RegulationCodeDisplay,
    RegulationError,
    type RegulationViolation,
    SizeMismatchError,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('blob backend error codes', () =>
{
    it('exposes the stable wire codes and subclasses BlobBackendError', () =>
    {
        const cases : [ BlobBackendError, string ][] = [
            [ new BlobNotFoundError('abc'), 'blob.notFound' ],
            [ new HashMismatchError('want', 'got'), 'blob.hashMismatch' ],
            [ new SizeMismatchError('abc', 10, 11), 'blob.sizeMismatch' ],
            [ new InvalidSha256Error('../nope'), 'blob.invalidSha256' ],
        ];

        for(const [ error, code ] of cases)
        {
            expect(error).toBeInstanceOf(BlobBackendError);
            expect(error).toBeInstanceOf(Error);
            expect(error.code).toBe(code);
        }
    });
});

describe('RegulationError', () =>
{
    it('carries the violations and takes its message from the first one', () =>
    {
        const violations : RegulationViolation[] = [
            { code: 'quota.exceeded', message: 'over quota' },
            { code: 'parent.trashed', message: 'trashed parent' },
        ];

        const error = new RegulationError(violations);

        expect(error.violations).toEqual(violations);
        expect(error.message).toBe('over quota');
    });

    it('is a refusal of authority when any violation is one', () =>
    {
        const error = new RegulationError([
            { code: 'quota.exceeded', message: 'over quota' },
            { code: 'parent.crossOwner', message: 'not your folder' },
        ]);

        expect(error.kind).toBe('forbidden');
    });

    it('is a refusal of an illegal state when no violation is about authority', () =>
    {
        const error = new RegulationError([
            { code: 'move.intoSelf', message: 'into itself' },
            { code: 'parent.trashed', message: 'trashed parent' },
        ]);

        expect(error.kind).toBe('illegalState');
    });

    it('shows the caller the rule and the resources involved, never the other users', () =>
    {
        const error = new RegulationError([
            {
                code: 'trash.notOwner',
                message: 'not yours',
                nodeID: 'node1',
                parentID: 'parent1',
                ownerID: 'owner1',
                actorID: 'caller1',
            },
        ]);

        expect(error.details).toEqual({
            violations: [ { code: 'trash.notOwner', message: 'not yours', nodeID: 'node1', parentID: 'parent1' } ],
        });
        expect(error.violations[0]?.ownerID).toBe('owner1');
    });
});

describe('RegulationCodeDisplay', () =>
{
    it('gives every code a non-blank human line', () =>
    {
        for(const [ code, line ] of Object.entries(RegulationCodeDisplay))
        {
            expect(line.trim(), code).not.toBe('');
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
