//----------------------------------------------------------------------------------------------------------------------
// Node Menu Engine
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { LinkTarget } from '@fileshed/core';

// Engines
import { nodeMenu } from '@client/engines/intent/menu.ts';

// Support
import { ME_ID, fileNode, folderNode, linkNode } from '../../support.ts';

//----------------------------------------------------------------------------------------------------------------------

const SOMEONE_ELSE = 'u2';

function target(type : LinkTarget['type']) : LinkTarget
{
    return { id: 't1', type, name: 'target', ownerID: SOMEONE_ELSE };
}

//----------------------------------------------------------------------------------------------------------------------

describe('nodeMenu', () =>
{
    it('offers an owner every action on a file, grouped open, share, edit, trash', () =>
    {
        expect(nodeMenu(fileNode(), ME_ID)).toEqual([
            [ 'open', 'download' ],
            [ 'share' ],
            [ 'rename', 'move', 'addLink', 'makeCopy' ],
            [ 'trash' ],
        ]);
    });

    it('hands out an existing public link in both forms beside Share', () =>
    {
        const shared = fileNode({ sharing: { granteeCount: 0, linkUrl: '/d/abc' } });

        expect(nodeMenu(shared, ME_ID)[1]).toEqual([ 'share', 'copyLink', 'copyDownloadLink' ]);
    });

    it('offers no download or copy of a folder', () =>
    {
        expect(nodeMenu(folderNode(), ME_ID)).toEqual([
            [ 'open' ],
            [ 'share' ],
            [ 'rename', 'move', 'addLink' ],
            [ 'trash' ],
        ]);
    });

    // A link has no ACL to share, cannot itself be linked to or copied, and is removed rather than trashed.
    it('offers an owner of a link to a file only what a link can do', () =>
    {
        expect(nodeMenu(linkNode({ target: target('file') }), ME_ID)).toEqual([
            [ 'open', 'download' ],
            [ 'rename', 'move' ],
            [ 'remove' ],
        ]);
    });

    it('offers a non-owner the read-only actions and nothing that administers the node', () =>
    {
        expect(nodeMenu(fileNode({ ownerID: SOMEONE_ELSE }), ME_ID)).toEqual([
            [ 'open', 'download' ],
            [ 'saveCopy', 'addLink' ],
        ]);
    });

    // A folder owner's inherited 'owner' role over a contribution inside it administers nothing: ownership is direct.
    it('reads ownership from the owner id, not the resolved role', () =>
    {
        const contribution = fileNode({ ownerID: SOMEONE_ELSE, role: 'owner' });

        expect(nodeMenu(contribution, ME_ID)).toEqual([
            [ 'open', 'download' ],
            [ 'saveCopy', 'addLink' ],
        ]);
    });

    it('leaves a non-owner of a link to a folder with Open alone', () =>
    {
        expect(nodeMenu(linkNode({ ownerID: SOMEONE_ELSE, target: target('folder') }), ME_ID)).toEqual([ [ 'open' ] ]);
    });

    it('treats a signed-out caller as owning nothing', () =>
    {
        expect(nodeMenu(folderNode(), null)).toEqual([ [ 'open' ], [ 'addLink' ] ]);
    });

    it('offers the owner of a dead link only its removal', () =>
    {
        expect(nodeMenu(linkNode({ target: null }), ME_ID)).toEqual([ [ 'remove' ] ]);
    });

    it('offers nothing on someone else\'s dead link', () =>
    {
        expect(nodeMenu(linkNode({ ownerID: SOMEONE_ELSE, target: null }), ME_ID)).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
