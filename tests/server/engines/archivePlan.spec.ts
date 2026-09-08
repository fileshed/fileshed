//----------------------------------------------------------------------------------------------------------------------
// Archive Plan
//
// Where a selection lands inside an archive. Derived from the contract the endpoint states: paths mirror the tree
// relative to the SELECTION, folders recurse, and a node that cannot go in is named in the manifest rather than
// failing the request.
//
// Pure, so these hand it nodes and roles and read the layout back -- no database, no store, no archive library.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import type { Node, Role } from '@fileshed/core';

// Engines
import {
    type ArchivePlan,
    OMITTED_TRASHED,
    OMITTED_UNREADABLE,
    planArchive,
} from '@server/engines/archivePlan.ts';

// Support
import { fileNode, folderNode, linkNode } from '../resource-access/nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const OWNER = 'alice';

// Everything readable unless a spec says otherwise: the interesting cases are the exceptions.
function readable(nodes : readonly Node[], except : Record<string, Role | null> = {}) : Map<string, Role | null>
{
    // hasOwn, not ??: an exception's whole point is a null role, which ?? would coalesce straight back to 'owner'.
    return new Map(nodes.map((node) : [ string, Role | null ] =>
    {
        return [ node.id, Object.hasOwn(except, node.id) ? except[node.id] ?? null : 'owner' ];
    }));
}

function plan(
    selectedIDs : string[],
    nodes : Node[],
    roles ?: Map<string, Role | null>,
    targets : Node[] = []
) : ArchivePlan
{
    return planArchive({
        selectedIDs,
        nodes,
        targets: new Map(targets.map((node) => [ node.id, node ])),
        roles: roles ?? readable([ ...nodes, ...targets ]),
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('planArchive', () =>
{
    it('puts a selected file at the archive root under its own name', () =>
    {
        const node = fileNode({ id: 'f1', name: 'budget.xlsx', ownerID: OWNER, blobID: 'sha-1', size: 40 });

        expect(plan([ 'f1' ], [ node ]).files).toEqual([
            { nodeID: 'f1', blobID: 'sha-1', size: 40, path: 'budget.xlsx' },
        ]);
    });

    // The point of "paths mirror the tree": a folder's own name leads, and everything under it keeps its shape.
    it('recurses a selected folder, mirroring the tree beneath it', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Reports', ownerID: OWNER }),
            fileNode({ id: 'f1', name: 'q1.pdf', ownerID: OWNER, parentID: 'd1', blobID: 'sha-1' }),
            folderNode({ id: 'd2', name: '2026', ownerID: OWNER, parentID: 'd1' }),
            fileNode({ id: 'f2', name: 'q2.pdf', ownerID: OWNER, parentID: 'd2', blobID: 'sha-2' }),
        ];

        const result = plan([ 'd1' ], nodes);

        expect(result.files.map((entry) => entry.path).sort())
            .toEqual([ 'Reports/2026/q2.pdf', 'Reports/q1.pdf' ]);
        expect(result.directories).toEqual([ 'Reports', 'Reports/2026' ]);
    });

    // Nothing above the selection comes with it: an archive of one deep folder is that folder, not the path to it.
    it('carries nothing of the folders the selection lived under', () =>
    {
        const nodes = [
            folderNode({ id: 'deep', name: 'Invoices', ownerID: OWNER, parentID: 'above' }),
            fileNode({ id: 'f1', name: 'jan.pdf', ownerID: OWNER, parentID: 'deep', blobID: 'sha-1' }),
        ];

        expect(plan([ 'deep' ], nodes).files.map((entry) => entry.path)).toEqual([ 'Invoices/jan.pdf' ]);
    });

    // An empty folder is still part of the tree, and a file list alone could not say it was there.
    it('keeps a folder that holds nothing', () =>
    {
        const nodes = [ folderNode({ id: 'd1', name: 'Empty', ownerID: OWNER }) ];

        const result = plan([ 'd1' ], nodes);

        expect(result.directories).toEqual([ 'Empty' ]);
        expect(result.files).toEqual([]);
    });

    it('lays out several selected roots side by side', () =>
    {
        const nodes = [
            fileNode({ id: 'f1', name: 'a.txt', ownerID: OWNER, blobID: 'sha-1' }),
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            fileNode({ id: 'f2', name: 'b.txt', ownerID: OWNER, parentID: 'd1', blobID: 'sha-2' }),
        ];

        expect(plan([ 'f1', 'd1' ], nodes).files.map((entry) => entry.path))
            .toEqual([ 'a.txt', 'Docs/b.txt' ]);
    });

    // Selecting a folder and something inside it is an ordinary drag; the child belongs in the folder, once.
    it('places a selected child inside its selected parent rather than twice', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            fileNode({ id: 'f1', name: 'a.txt', ownerID: OWNER, parentID: 'd1', blobID: 'sha-1' }),
        ];

        const result = plan([ 'd1', 'f1' ], nodes);

        expect(result.files.map((entry) => entry.path)).toEqual([ 'Docs/a.txt' ]);
    });

    // Two roots from different folders can carry one name, and the archive has one root to put them in.
    it('numbers a name two selected roots both claim', () =>
    {
        const nodes = [
            fileNode({ id: 'f1', name: 'report.pdf', ownerID: OWNER, parentID: 'x', blobID: 'sha-1' }),
            fileNode({ id: 'f2', name: 'report.pdf', ownerID: OWNER, parentID: 'y', blobID: 'sha-2' }),
        ];

        expect(plan([ 'f1', 'f2' ], nodes).files.map((entry) => entry.path))
            .toEqual([ 'report.pdf', 'report (2).pdf' ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // What is left out, and what the manifest says about it
    //------------------------------------------------------------------------------------------------------------------

    it('omits a node the caller cannot read, naming it', () =>
    {
        const nodes = [
            fileNode({ id: 'f1', name: 'mine.txt', ownerID: OWNER, blobID: 'sha-1' }),
            fileNode({ id: 'f2', name: 'theirs.txt', ownerID: 'someone-else', blobID: 'sha-2' }),
        ];

        const result = plan([ 'f1', 'f2' ], nodes, readable(nodes, { f2: null }));

        expect(result.files.map((entry) => entry.path)).toEqual([ 'mine.txt' ]);
        expect(result.omissions).toEqual([ { path: 'theirs.txt', reason: OMITTED_UNREADABLE } ]);
    });

    // Trashing a folder stamps its whole subtree, so a trashed node under a live folder is one somebody threw away
    // on purpose. Putting it back in an archive of that folder would undo the throwing away.
    it('omits a trashed node inside a live folder, naming it', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            fileNode({ id: 'f1', name: 'kept.txt', ownerID: OWNER, parentID: 'd1', blobID: 'sha-1' }),
            fileNode({
                id: 'f2',
                name: 'binned.txt',
                ownerID: OWNER,
                parentID: 'd1',
                blobID: 'sha-2',
                trashedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
        ];

        const result = plan([ 'd1' ], nodes);

        expect(result.files.map((entry) => entry.path)).toEqual([ 'Docs/kept.txt' ]);
        expect(result.omissions).toEqual([ { path: 'Docs/binned.txt', reason: OMITTED_TRASHED } ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Links, which resolve to what they point at
    //------------------------------------------------------------------------------------------------------------------

    // The bytes are the target's; the name is the link's, because the link's name is what the tree shows.
    it('follows a link to its file, under the link\'s own name', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            linkNode({ id: 'l1', name: 'shortcut.pdf', ownerID: OWNER, parentID: 'd1', targetNodeID: 't1' }),
        ];
        const target = fileNode({ id: 't1', name: 'real.pdf', ownerID: 'someone-else', blobID: 'sha-9', size: 22 });

        const result = plan([ 'd1' ], nodes, undefined, [ target ]);

        expect(result.files).toEqual([
            { nodeID: 't1', blobID: 'sha-9', size: 22, path: 'Docs/shortcut.pdf' },
        ]);
        expect(result.omissions).toEqual([]);
    });

    // The link is not what is being read; the thing it points at is. A caller who can reach the link but not its
    // target gets the same answer they would get asking for the target directly.
    it('judges a link on the target\'s access, not the link\'s', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            linkNode({ id: 'l1', name: 'shortcut.pdf', ownerID: OWNER, parentID: 'd1', targetNodeID: 't1' }),
        ];
        const target = fileNode({ id: 't1', name: 'secret.pdf', ownerID: 'someone-else', blobID: 'sha-9' });

        const roles = readable([ ...nodes, target ], { t1: null });
        const result = plan([ 'd1' ], nodes, roles, [ target ]);

        expect(result.files).toEqual([]);
        expect(result.omissions).toEqual([
            { path: 'Docs/shortcut.pdf', reason: 'a link to "secret.pdf", which is not readable by you' },
        ]);
    });

    // Naming the target is the point of the note: "a link" alone tells the reader nothing they did not know.
    it('names what a dead link pointed at, as far as it can', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            linkNode({ id: 'l1', name: 'shortcut', ownerID: OWNER, parentID: 'd1', targetNodeID: 'gone' }),
        ];

        expect(plan([ 'd1' ], nodes).omissions).toEqual([
            { path: 'Docs/shortcut', reason: 'a link to something that no longer exists' },
        ]);
    });

    // Following one would reach outside the selection, and a link pointing back at an ancestor would have no end.
    it('does not follow a link to a folder, and says so', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            linkNode({ id: 'l1', name: 'elsewhere', ownerID: OWNER, parentID: 'd1', targetNodeID: 't1' }),
        ];
        const target = folderNode({ id: 't1', name: 'Shared Album', ownerID: 'someone-else' });

        expect(plan([ 'd1' ], nodes, undefined, [ target ]).omissions).toEqual([
            { path: 'Docs/elsewhere', reason: 'a link to the folder "Shared Album", which is not followed' },
        ]);
    });

    it('leaves out a link whose target is in the trash, naming it', () =>
    {
        const nodes = [ linkNode({ id: 'l1', name: 'shortcut', ownerID: OWNER, targetNodeID: 't1' }) ];
        const target = fileNode({
            id: 't1',
            name: 'binned.pdf',
            ownerID: OWNER,
            blobID: 'sha-9',
            trashedAt: new Date('2026-01-01T00:00:00.000Z'),
        });

        expect(plan([ 'l1' ], nodes, undefined, [ target ]).omissions).toEqual([
            { path: 'shortcut', reason: 'a link to "binned.pdf", which is in the trash' },
        ]);
    });

    // The same content really is in the tree twice, so it is in the archive twice: an archive that silently deduped
    // would not mirror the tree it claims to.
    it('carries content reached both directly and through a link, twice', () =>
    {
        const target = fileNode({ id: 't1', name: 'real.pdf', ownerID: OWNER, parentID: 'd1', blobID: 'sha-9' });
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            target,
            linkNode({ id: 'l1', name: 'shortcut.pdf', ownerID: OWNER, parentID: 'd1', targetNodeID: 't1' }),
        ];

        // A target already inside the walk is still a target, exactly as the manager hands it over.
        const result = plan([ 'd1' ], nodes, undefined, [ target ]);

        expect(result.files.map((entry) => entry.path).sort())
            .toEqual([ 'Docs/real.pdf', 'Docs/shortcut.pdf' ]);
    });

    it('reports nothing omitted when everything went in', () =>
    {
        const nodes = [ fileNode({ id: 'f1', name: 'a.txt', ownerID: OWNER, blobID: 'sha-1' }) ];

        expect(plan([ 'f1' ], nodes).omissions).toEqual([]);
    });

    it('ignores a selected id no walk returned', () =>
    {
        const nodes = [ fileNode({ id: 'f1', name: 'a.txt', ownerID: OWNER, blobID: 'sha-1' }) ];

        expect(plan([ 'f1', 'gone' ], nodes).files.map((entry) => entry.path)).toEqual([ 'a.txt' ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Names, which are the caller's and go straight into a path
    //------------------------------------------------------------------------------------------------------------------

    // A name is a name, never a path: a separator in one must not let an entry climb out of the folder it belongs in.
    it('refuses to let a separator in a name become a path', () =>
    {
        const nodes = [
            folderNode({ id: 'd1', name: 'Docs', ownerID: OWNER }),
            fileNode({ id: 'f1', name: '../../etc/passwd', ownerID: OWNER, parentID: 'd1', blobID: 'sha-1' }),
        ];

        expect(plan([ 'd1' ], nodes).files.map((entry) => entry.path)).toEqual([ 'Docs/.._.._etc_passwd' ]);
    });

    it('keeps the spaces and punctuation a name is entitled to', () =>
    {
        const nodes = [
            fileNode({ id: 'f1', name: 'Q1 report - final (v2).pdf', ownerID: OWNER, blobID: 'sha-1' }),
        ];

        expect(plan([ 'f1' ], nodes).files.map((entry) => entry.path)).toEqual([ 'Q1 report - final (v2).pdf' ]);
    });

    it('stands in for a name that survives sanitising as nothing', () =>
    {
        const nodes = [ fileNode({ id: 'f1', name: '..', ownerID: OWNER, blobID: 'sha-1' }) ];

        expect(plan([ 'f1' ], nodes).files.map((entry) => entry.path)).toEqual([ '_' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
