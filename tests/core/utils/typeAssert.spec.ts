//----------------------------------------------------------------------------------------------------------------------
// Type Assertions — the check every codec in this package leans on
//
// `typeAssert<Equals<z.output<typeof codec>, TheType>>()` is what makes a drifted codec a build failure instead of a
// value that quietly stops crossing the wire. These cases are the proof that it does, and they are checked by the
// compiler rather than by anything at runtime: a `@ts-expect-error` that stops being an error is itself an error, so
// an Equals that went back to being lenient fails here.
//
// It was lenient. Assignability -- what it used to compare -- ignores an optional property missing from one side, so a
// codec that had stopped producing one went on proving it matched. That shipped a user preference that was written to
// the database and never read back, with a clean build and a green suite.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Utils
import { type Equals, typeAssert } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

interface Canonical
{
    required : string;
    optional ?: boolean;
}

//----------------------------------------------------------------------------------------------------------------------

describe('Equals', () =>
{
    it('accepts a shape that matches the canonical type exactly', () =>
    {
        typeAssert<Equals<{ required : string; optional ?: boolean }, Canonical>>();

        expect(true).toBe(true);
    });

    // The case that got through. An optional property is assignable in both directions whether it is there or not,
    // so nothing but an identity comparison notices it went missing.
    it('refuses a shape missing an optional property', () =>
    {
        // @ts-expect-error -- the shape drops `optional`, which is the drift this exists to catch
        typeAssert<Equals<{ required : string }, Canonical>>();

        expect(true).toBe(true);
    });

    it('refuses a shape missing a required property', () =>
    {
        // @ts-expect-error -- the shape drops `required`
        typeAssert<Equals<{ optional ?: boolean }, Canonical>>();

        expect(true).toBe(true);
    });

    it('refuses a shape carrying a property the canonical type does not have', () =>
    {
        // @ts-expect-error -- the shape adds `extra`
        typeAssert<Equals<{ required : string; optional ?: boolean; extra : number }, Canonical>>();

        expect(true).toBe(true);
    });

    // A required property whose type admits undefined is not the same as an optional one, and a codec producing the
    // first where the type says the second is drift a reader would never see.
    it('refuses a required property standing in for an optional one', () =>
    {
        // @ts-expect-error -- `optional` is required here, and merely admits undefined
        typeAssert<Equals<{ required : string; optional : boolean | undefined }, Canonical>>();

        expect(true).toBe(true);
    });

    // Unions are compared whole rather than member by member, which is what the old implementation's tuples were for.
    it('compares a union as one type', () =>
    {
        typeAssert<Equals<'a' | 'b', 'a' | 'b'>>();

        // @ts-expect-error -- a narrower union is not the same type
        typeAssert<Equals<'a', 'a' | 'b'>>();

        expect(true).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
