//----------------------------------------------------------------------------------------------------------------------
// Location Engine — the ancestor chain a caller is allowed to see
//
// A node's location is its ancestor chain cut at the first ancestor the caller cannot resolve, rendered highest
// surviving ancestor first. `foreign` says where that surviving chain roots: false only when it reaches a null parent
// the caller owns -- their own files root -- and true whenever the walk stopped short or topped out in someone else's
// tree. Pure logic, real data, no mocks.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { type LocationAncestor, resolveLocation } from '@server/engines/location.ts';

//----------------------------------------------------------------------------------------------------------------------

function ancestor(id : string, ownerID : string, parentID : string | null) : LocationAncestor
{
    return { id, name: `${ id }-folder`, ownerID, parentID };
}

//----------------------------------------------------------------------------------------------------------------------

describe('resolveLocation', () =>
{
    // The caller owns the whole path, so nothing is cut: every ancestor renders, ordered root-first the way a
    // breadcrumb reads, and the chain roots in their own tree.
    it('renders the whole chain highest ancestor first when the caller owns the path to the root', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: 'quarter',
            ancestors: [ ancestor('quarter', 'alice', 'projects'), ancestor('projects', 'alice', null) ],
            visibleIDs: new Set([ 'quarter', 'projects' ]),
            actorID: 'alice',
        });

        expect(location.crumbs).toEqual([
            { id: 'projects', name: 'projects-folder' },
            { id: 'quarter', name: 'quarter-folder' },
        ]);
        expect(location.foreign).toBe(false);
    });

    // The share root is the highest ancestor a grantee can resolve. Everything above it belongs to the owner alone, so
    // the chain stops there rather than naming the owner's folders.
    it('cuts the chain at the highest ancestor the caller can resolve, never naming the ones above it', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: 'shared',
            ancestors: [
                ancestor('shared', 'alice', 'private'),
                ancestor('private', 'alice', 'aliceRoot'),
                ancestor('aliceRoot', 'alice', null),
            ],
            visibleIDs: new Set([ 'shared' ]),
            actorID: 'bob',
        });

        expect(location.crumbs).toEqual([ { id: 'shared', name: 'shared-folder' } ]);
        expect(location.foreign).toBe(true);
    });

    // Nothing above the node is reachable, so there is no chain to show at all -- but the caller still needs to know
    // the node lives outside their own tree.
    it('reports an empty foreign chain when even the direct parent is out of reach', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: 'private',
            ancestors: [ ancestor('private', 'alice', null) ],
            visibleIDs: new Set(),
            actorID: 'bob',
        });

        expect(location.crumbs).toEqual([]);
        expect(location.foreign).toBe(true);
    });

    // A node sitting at the caller's own root has no ancestors and belongs to them: the location is their files root,
    // which is exactly an empty own-tree chain.
    it('treats a node at the caller\'s own root as an empty chain rooted in their own tree', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: null,
            ancestors: [],
            visibleIDs: new Set(),
            actorID: 'alice',
        });

        expect(location.crumbs).toEqual([]);
        expect(location.foreign).toBe(false);
    });

    // An empty chain is not proof of the caller's own root: a file shared to them straight off someone else's root has
    // no ancestors either, and must not be presented as living in the caller's files.
    it('marks an empty chain foreign when the node sits at another owner\'s root', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: null,
            ancestors: [],
            visibleIDs: new Set(),
            actorID: 'bob',
        });

        expect(location.crumbs).toEqual([]);
        expect(location.foreign).toBe(true);
    });

    // A grantee who can see all the way up to the owner's root gets every folder name -- the walk was never cut -- but
    // the chain still roots in a tree that is not theirs.
    it('keeps a fully visible chain foreign when it roots in another owner\'s tree', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: 'inner',
            ancestors: [ ancestor('inner', 'alice', 'outer'), ancestor('outer', 'alice', null) ],
            visibleIDs: new Set([ 'inner', 'outer' ]),
            actorID: 'bob',
        });

        expect(location.crumbs).toEqual([
            { id: 'outer', name: 'outer-folder' },
            { id: 'inner', name: 'inner-folder' },
        ]);
        expect(location.foreign).toBe(true);
    });

    // A gap only ever ends the walk. An ancestor the caller happens to reach ABOVE an unreachable one cannot rejoin the
    // chain, or the location would name a folder whose position the caller was never allowed to learn.
    it('stops at the first gap even when a higher ancestor is reachable on its own', () =>
    {
        const location = resolveLocation({
            ownerID: 'alice',
            parentID: 'visibleParent',
            ancestors: [
                ancestor('visibleParent', 'alice', 'hidden'),
                ancestor('hidden', 'alice', 'topShared'),
                ancestor('topShared', 'alice', null),
            ],
            visibleIDs: new Set([ 'visibleParent', 'topShared' ]),
            actorID: 'bob',
        });

        expect(location.crumbs).toEqual([ { id: 'visibleParent', name: 'visibleParent-folder' } ]);
        expect(location.foreign).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
