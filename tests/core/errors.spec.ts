//----------------------------------------------------------------------------------------------------------------------
// Shared Error Vocabulary
//
// The error classes are plain and portable; what matters on the wire is their stable `code` strings and the violations
// a RegulationError carries (requirements.md sec 3.6/4.3). These assert that contract, not the class plumbing.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    BlobBackendError,
    BlobNotFoundError,
    HashMismatchError,
    InvalidSha256Error,
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
});

//----------------------------------------------------------------------------------------------------------------------
