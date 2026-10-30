//----------------------------------------------------------------------------------------------------------------------
// Owner Resolution
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { LinkTarget, UserSummary } from '@fileshed/core';

import { ownerIDFor, resolveOwner } from '@client/utils/resolveOwner.ts';

// Support
import { fileNode, linkNode } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

function summary(id : string) : UserSummary
{
    return { id, name: `User ${ id }`, email: `${ id }@example.com`, image: null };
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
        expect(ownerIDFor(fileNode({ ownerID: 'u1' }))).toBe('u1');
    });

    // A link is a recipient's placement pointing at someone else's file -- the Owner column names the target's
    // owner, not the recipient who placed the link.
    it('attributes a resolved link to its TARGET\'s ownerID, not the link\'s own', () =>
    {
        const target : LinkTarget = { id: 't1', type: 'file', name: 'photo.jpg', ownerID: 'u2' };

        expect(ownerIDFor(linkNode({ ownerID: 'recipient', target }))).toBe('u2');
    });

    // A dead link has no resolvable target to attribute to, so it falls back to its own owner (the recipient).
    it('falls back to the link\'s own ownerID when the target is unresolved', () =>
    {
        expect(ownerIDFor(linkNode({ ownerID: 'recipient' }))).toBe('recipient');
    });
});

//----------------------------------------------------------------------------------------------------------------------
