//----------------------------------------------------------------------------------------------------------------------
// Access Token Vocabulary — scopes, statements, and the containment math
//
// The contract under test: a scope is a UI-level bundle whose statement STORES every action the bundle implies
// (broader scopes carry the narrower actions), route demands are single actions, and verification is exact
// containment with no hierarchy. These are the rules that make "a read key cannot download-only-but-not-read" and
// "a write key needs no special-casing at verify time" true.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    accessTokenScopes,
    permissionDemands,
    scopeStatements,
    scopesFromStatement,
    statementForScopes,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('scopeStatements', () =>
{
    it('bundles broader file scopes over the narrower actions, so one checkbox mints a usable key', () =>
    {
        expect(scopeStatements['files:download']).toEqual({ files: [ 'download' ] });
        expect(scopeStatements['files:read'].files).toEqual(expect.arrayContaining([ 'read', 'download' ]));
        expect(scopeStatements['files:write'].files)
            .toEqual(expect.arrayContaining([ 'read', 'download', 'write' ]));
        expect(scopeStatements['shares:write'].shares).toEqual(expect.arrayContaining([ 'read', 'write' ]));
    });

    it('defines a statement for every scope in the vocabulary', () =>
    {
        for(const scope of accessTokenScopes)
        {
            expect(Object.keys(scopeStatements[scope]).length).toBeGreaterThan(0);
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('permissionDemands', () =>
{
    it('demands exactly one action per route family, never a scope bundle', () =>
    {
        for(const demand of Object.values(permissionDemands))
        {
            const resources = Object.entries(demand);
            expect(resources).toHaveLength(1);

            const [ , actions ] = resources[0] as [ string, string[] ];
            expect(actions).toHaveLength(1);
        }
    });

    it('is satisfiable by the scope sold as unlocking it', () =>
    {
        const satisfies = (scope : keyof typeof scopeStatements, demand : Record<string, string[]>) : boolean =>
        {
            return Object.entries(demand).every(([ resource, actions ]) =>
            {
                const held = scopeStatements[scope][resource];
                return held !== undefined && actions.every((action) => held.includes(action));
            });
        };

        expect(satisfies('files:download', permissionDemands.filesDownload)).toBe(true);
        expect(satisfies('files:read', permissionDemands.filesRead)).toBe(true);
        expect(satisfies('files:read', permissionDemands.filesDownload)).toBe(true);
        expect(satisfies('files:write', permissionDemands.filesWrite)).toBe(true);
        expect(satisfies('shares:read', permissionDemands.sharesRead)).toBe(true);
        expect(satisfies('shares:write', permissionDemands.sharesWrite)).toBe(true);
        expect(satisfies('account:read', permissionDemands.accountRead)).toBe(true);

        // The gaps that keep least-privilege honest: download-only cannot browse, read cannot write, and the
        // shares scopes never touch files.
        expect(satisfies('files:download', permissionDemands.filesRead)).toBe(false);
        expect(satisfies('files:read', permissionDemands.filesWrite)).toBe(false);
        expect(satisfies('shares:write', permissionDemands.filesRead)).toBe(false);
        expect(satisfies('account:read', permissionDemands.filesDownload)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('statementForScopes', () =>
{
    it('unions the chosen scopes into one statement without duplicate actions', () =>
    {
        const statement = statementForScopes([ 'files:read', 'files:write', 'shares:read' ]);

        expect(statement.files?.slice().sort()).toEqual([ 'download', 'read', 'write' ]);
        expect(statement.shares).toEqual([ 'read' ]);
        expect(statement.account).toBeUndefined();
    });

    it('yields an empty statement for no scopes, which satisfies no demand', () =>
    {
        expect(statementForScopes([])).toEqual({});
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('scopesFromStatement', () =>
{
    it('round-trips every single scope through its own statement', () =>
    {
        for(const scope of accessTokenScopes)
        {
            expect(scopesFromStatement(scopeStatements[scope])).toContain(scope);
        }
    });

    it('reads a full-preset union back as every scope it was built from', () =>
    {
        const statement = statementForScopes([ 'files:write', 'shares:write', 'account:read' ]);

        const scopes = scopesFromStatement(statement);

        // files:write stores read and download too, so the narrower file scopes correctly read as granted.
        expect(scopes).toEqual(expect.arrayContaining([
            'files:download',
            'files:read',
            'files:write',
            'shares:read',
            'shares:write',
            'account:read',
        ]));
    });

    it('grants nothing for an empty or unrelated statement', () =>
    {
        expect(scopesFromStatement({})).toEqual([]);
        expect(scopesFromStatement({ gadgets: [ 'frobnicate' ] })).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
