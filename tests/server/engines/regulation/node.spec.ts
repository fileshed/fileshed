//----------------------------------------------------------------------------------------------------------------------
// Node Regulation -- link, parent-edge, move, and trash legality
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import type { FileNode, FolderNode, LinkNode } from '@fileshed/core';

// Regulation
import type { RegulationResult } from '@server/engines/regulation/types.ts';
import { judgeLinkCreation, judgeMove, judgeParentEdge, judgeTrash } from '@server/engines/regulation/node.ts';

//----------------------------------------------------------------------------------------------------------------------

const AT = new Date('2026-01-01T00:00:00.000Z');

function folder(overrides : Partial<FolderNode> = {}) : FolderNode
{
    return {
        type: 'folder',
        id: 'folder_1',
        name: 'Docs',
        ownerID: 'user_owner',
        parentID: null,
        createdAt: AT,
        updatedAt: AT,
        trashedAt: null,
        ...overrides,
    };
}

function file(overrides : Partial<FileNode> = {}) : FileNode
{
    return {
        type: 'file',
        id: 'file_1',
        name: 'report.pdf',
        ownerID: 'user_owner',
        parentID: null,
        blobID: 'blob_1',
        size: 2048,
        mimeType: 'application/pdf',
        createdAt: AT,
        updatedAt: AT,
        trashedAt: null,
        ...overrides,
    };
}

function link(overrides : Partial<LinkNode> = {}) : LinkNode
{
    return {
        type: 'link',
        id: 'link_1',
        name: 'Shared report.pdf',
        ownerID: 'user_recipient',
        parentID: 'folder_1',
        targetNodeID: 'file_1',
        createdAt: AT,
        updatedAt: AT,
        ...overrides,
    };
}

function codes(result : RegulationResult) : string[]
{
    return result.ok ? [] : result.violations.map((violation) => violation.code);
}

//----------------------------------------------------------------------------------------------------------------------

describe('judgeLinkCreation', () =>
{
    // requirements.md sec 3.2b: links may not target links.
    it('rejects a link whose target is another link', () =>
    {
        const result = judgeLinkCreation({
            linkID: 'link_new',
            targetNodeID: 'link_other',
            targetType: 'link',
            creatorRoleOnTarget: 'viewer',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('link.targetIsLink');
    });

    // requirements.md sec 3.2b: a link may not point at itself.
    it('rejects a link that targets itself', () =>
    {
        const result = judgeLinkCreation({
            linkID: 'node_x',
            targetNodeID: 'node_x',
            targetType: 'file',
            creatorRoleOnTarget: 'owner',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('link.selfTarget');
    });

    // requirements.md sec 3.2b: creating a link requires ownership of or an active share on the target; no access
    // resolves to no role.
    it('rejects a link when the creator has no access to the target', () =>
    {
        const result = judgeLinkCreation({
            linkID: 'link_new',
            targetNodeID: 'file_1',
            targetType: 'file',
            creatorRoleOnTarget: null,
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toEqual([ 'link.noAccess' ]);
    });

    // requirements.md sec 3.2b: self-links onto a node you own are allowed, same rules, no special casing -- ownership
    // shows up as an owner role on the target.
    it('admits a link onto a different node the creator owns', () =>
    {
        const result = judgeLinkCreation({
            linkID: 'link_new',
            targetNodeID: 'file_1',
            targetType: 'file',
            creatorRoleOnTarget: 'owner',
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 3.2b: an active share on the target -- viewer is enough -- authorizes creating a link to it.
    it('admits a link to a folder the creator holds a viewer share on', () =>
    {
        const result = judgeLinkCreation({
            linkID: 'link_new',
            targetNodeID: 'folder_9',
            targetType: 'folder',
            creatorRoleOnTarget: 'viewer',
        });

        expect(result.ok).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('judgeParentEdge', () =>
{
    // requirements.md sec 3.2: a null parent is root-level placement in the creator's own tree -- always legal.
    it('admits root-level placement', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_owner',
            parent: null,
            creatorRoleOnParent: null,
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 3.2: parent_id points at a folder.
    it('rejects a parent that is not a folder', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_owner',
            parent: file(),
            creatorRoleOnParent: 'owner',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toEqual([ 'parent.notFolder' ]);
    });

    // requirements.md sec 4.4: a trashed subtree is hidden; new nodes may not be created inside a trashed folder.
    it('rejects a trashed parent folder', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_owner',
            parent: folder({ trashedAt: AT }),
            creatorRoleOnParent: 'owner',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('parent.trashed');
    });

    // requirements.md sec 3.2: the same-owner parent rule -- a creator may place a node inside their own folder.
    it('admits placement inside the creator\'s own folder', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_owner',
            parent: folder({ ownerID: 'user_owner' }),
            creatorRoleOnParent: 'owner',
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 3.3: the one sanctioned cross-owner edge -- an editor on a shared folder may create inside
    // it, the new node owned by the creator, parent owned by someone else.
    it('admits cross-owner placement when the creator is an editor on the shared folder', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_creator',
            parent: folder({ ownerID: 'user_owner' }),
            creatorRoleOnParent: 'editor',
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 3.3: the cross-owner exception is editor-only -- a viewer cannot create inside someone
    // else's folder.
    it('rejects cross-owner placement when the creator is only a viewer', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_creator',
            parent: folder({ ownerID: 'user_owner' }),
            creatorRoleOnParent: 'viewer',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('parent.crossOwner');
    });

    // requirements.md sec 3.3: without any access to the shared folder there is no sanctioned cross-owner edge.
    it('rejects cross-owner placement when the creator has no access', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_creator',
            parent: folder({ ownerID: 'user_owner' }),
            creatorRoleOnParent: null,
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('parent.crossOwner');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('judgeMove', () =>
{
    // requirements.md sec 3.2: cycle prevention applies to real parent edges; a move to the root can never form a
    // cycle.
    it('admits a move to the root', () =>
    {
        const result = judgeMove({
            nodeID: 'folder_a',
            newParentID: null,
            parentAncestorIDs: [],
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 3.2: a node may not become its own parent.
    it('rejects a move of a node into itself', () =>
    {
        const result = judgeMove({
            nodeID: 'folder_a',
            newParentID: 'folder_a',
            parentAncestorIDs: [],
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('move.intoSelf');
    });

    // requirements.md sec 3.2: a node may not be moved beneath one of its own descendants -- it appears in the
    // destination's ancestor chain.
    it('rejects a move into the node\'s own descendant', () =>
    {
        const result = judgeMove({
            nodeID: 'folder_a',
            newParentID: 'folder_c',
            parentAncestorIDs: [ 'folder_b', 'folder_a' ],
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('move.intoDescendant');
    });

    // requirements.md sec 3.2: a move into an unrelated folder (the node is nowhere in the destination's ancestry)
    // forms no cycle.
    it('admits a move into an unrelated folder', () =>
    {
        const result = judgeMove({
            nodeID: 'folder_a',
            newParentID: 'folder_z',
            parentAncestorIDs: [ 'folder_y', 'folder_root' ],
        });

        expect(result.ok).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('judgeTrash', () =>
{
    // requirements.md sec 4.4: an owner may trash a node they own.
    it('admits an owner trashing their own file', () =>
    {
        const result = judgeTrash({
            node: file({ ownerID: 'user_owner' }),
            actorID: 'user_owner',
        });

        expect(result.ok).toBe(true);
    });

    // requirements.md sec 4.4: links are deleted directly, never trashed.
    it('rejects trashing a link', () =>
    {
        const result = judgeTrash({
            node: link({ ownerID: 'user_recipient' }),
            actorID: 'user_recipient',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('trash.linkNotTrashable');
    });

    // requirements.md sec 4.4: recipients cannot trash nodes they don't own.
    it('rejects trashing a node the actor does not own', () =>
    {
        const result = judgeTrash({
            node: file({ ownerID: 'user_owner' }),
            actorID: 'user_other',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('trash.notOwner');
    });

    // requirements.md sec 4.4: a link is never trashable and only the owner may trash -- a non-owner trashing someone
    // else's link violates both.
    it('reports both violations when a non-owner trashes a link they do not own', () =>
    {
        const result = judgeTrash({
            node: link({ ownerID: 'user_recipient' }),
            actorID: 'user_other',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toEqual(expect.arrayContaining([ 'trash.linkNotTrashable', 'trash.notOwner' ]));
    });
});

//----------------------------------------------------------------------------------------------------------------------
