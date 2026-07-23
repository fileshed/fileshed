//----------------------------------------------------------------------------------------------------------------------
// Owner Resolution
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { LinkTarget, NodeResponse, UserSummary } from '@fileshed/core';

import { ownerIDFor, resolveOwner } from '@client/utils/resolveOwner.ts';

//----------------------------------------------------------------------------------------------------------------------

function summary(id : string) : UserSummary
{
    return { id, name: `User ${ id }`, email: `${ id }@example.com`, image: null };
}

const BASE = {
    id: 'n1',
    name: 'thing',
    parentID: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    role: 'owner' as const,
};

function fileNode(ownerID : string) : NodeResponse
{
    return {
        ...BASE, ownerID, type: 'file', blobID: 'b1', size: 10, mimeType: 'text/plain', trashedAt: null,
    };
}

function linkNode(ownerID : string, target : LinkTarget | null) : NodeResponse
{
    return { ...BASE, ownerID, type: 'link', targetNodeID: 't1', target };
}

//----------------------------------------------------------------------------------------------------------------------

describe('resolveOwner', () =>
{
    it('finds the owner matching the given id in the facet', () =>
    {
        const owners = [ summary('u1'), summary('u2') ];

        expect(resolveOwner('u2', owners)).toEqual(summary('u2'));
    });

    it('falls back to null when no owner in the facet matches', () =>
    {
        const owners = [ summary('u1') ];

        expect(resolveOwner('u-missing', owners)).toBeNull();
    });

    it('falls back to null against an empty facet', () =>
    {
        expect(resolveOwner('u1', [])).toBeNull();
    });
});

describe('ownerIDFor', () =>
{
    it('attributes a file or folder to its own ownerID', () =>
    {
        expect(ownerIDFor(fileNode('u1'))).toBe('u1');
    });

    // A link is a recipient's placement pointing at someone else's file -- the Owner column names the target's
    // owner, not the recipient who placed the link.
    it('attributes a resolved link to its TARGET\'s ownerID, not the link\'s own', () =>
    {
        const target : LinkTarget = { id: 't1', type: 'file', name: 'photo.jpg', ownerID: 'u2' };

        expect(ownerIDFor(linkNode('recipient', target))).toBe('u2');
    });

    // A dead link has no resolvable target to attribute to, so it falls back to its own owner (the recipient).
    it('falls back to the link\'s own ownerID when the target is unresolved', () =>
    {
        expect(ownerIDFor(linkNode('recipient', null))).toBe('recipient');
    });
});

//----------------------------------------------------------------------------------------------------------------------
