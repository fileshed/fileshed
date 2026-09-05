//----------------------------------------------------------------------------------------------------------------------
// Node Regulation -- link, parent-edge, depth, move, and trash legality
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import { type FileNode, type FolderNode, type LinkNode, MAX_PLACEMENT_DEPTH } from '@fileshed/core';

// Regulation
import type { RegulationResult } from '@server/engines/regulation/types.ts';
import {
    judgeCopy,
    judgeLinkCreation,
    judgeMove,
    judgeParentEdge,
    judgePlacementDepth,
    judgeTrash,
} from '@server/engines/regulation/node.ts';

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
    // links may not target links.
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

    // a link may not point at itself.
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

    // creating a link requires ownership of or an active share on the target; no access resolves to no role.
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

    // self-links onto a node you own are allowed, same rules, no special casing -- ownership shows up as an owner role
    // on the target.
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

    // an active share on the target -- viewer is enough -- authorizes creating a link to it.
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
    // a null parent is root-level placement in the creator's own tree -- always legal.
    it('admits root-level placement', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_owner',
            parent: null,
            creatorRoleOnParent: null,
        });

        expect(result.ok).toBe(true);
    });

    // parent_id points at a folder.
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

    // a trashed subtree is hidden; new nodes may not be created inside a trashed folder.
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

    // the same-owner parent rule -- a creator may place a node inside their own folder.
    it('admits placement inside the creator\'s own folder', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_owner',
            parent: folder({ ownerID: 'user_owner' }),
            creatorRoleOnParent: 'owner',
        });

        expect(result.ok).toBe(true);
    });

    // the one sanctioned cross-owner edge -- an editor on a shared folder may create inside it, the new node owned by
    // the creator, parent owned by someone else.
    it('admits cross-owner placement when the creator is an editor on the shared folder', () =>
    {
        const result = judgeParentEdge({
            creatorID: 'user_creator',
            parent: folder({ ownerID: 'user_owner' }),
            creatorRoleOnParent: 'editor',
        });

        expect(result.ok).toBe(true);
    });

    // the cross-owner exception is editor-only -- a viewer cannot create inside someone else's folder.
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

    // without any access to the shared folder there is no sanctioned cross-owner edge.
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

describe('judgePlacementDepth', () =>
{
    // The ceiling is one rung under the walk bound, so that a file landing inside the deepest folder a user may create
    // still has its whole ancestor chain within reach of the walk.
    it('admits a placement that lands on the deepest allowed rung', () =>
    {
        const result = judgePlacementDepth({
            parentID: 'folder_deep',
            placedDepth: MAX_PLACEMENT_DEPTH,
            placedHeight: 0,
        });

        expect(result.ok).toBe(true);
    });

    it('rejects a placement one rung past the ceiling, naming the destination', () =>
    {
        const result = judgePlacementDepth({
            parentID: 'folder_deep',
            placedDepth: MAX_PLACEMENT_DEPTH + 1,
            placedHeight: 0,
        });

        if(result.ok) { throw new Error('the placement was allowed'); }

        expect(codes(result)).toEqual([ 'parent.tooDeep' ]);
        expect(result.violations[0]?.parentID).toBe('folder_deep');
    });

    // A move carries a subtree, so the judgement is about its DEEPEST node: the same destination that holds a file
    // cannot hold a folder with two rungs under it.
    it('judges the deepest node the placement would land, not its root', () =>
    {
        const destination = { parentID: 'folder_deep', placedDepth: MAX_PLACEMENT_DEPTH - 2 };

        expect(judgePlacementDepth({ ...destination, placedHeight: 2 }).ok).toBe(true);
        expect(judgePlacementDepth({ ...destination, placedHeight: 3 }).ok).toBe(false);
    });

    // Root placement is depth 0, which nothing of legal height can exceed -- but a subtree that is ALREADY taller than
    // the tree is allowed to be has nowhere legal to land, and says so without a parent to name.
    it('admits root placement of an ordinary subtree and refuses an over-tall one', () =>
    {
        expect(judgePlacementDepth({ parentID: null, placedDepth: 0, placedHeight: 4 }).ok).toBe(true);

        const overTall = judgePlacementDepth({
            parentID: null,
            placedDepth: 0,
            placedHeight: MAX_PLACEMENT_DEPTH + 1,
        });

        if(overTall.ok) { throw new Error('the placement was allowed'); }

        expect(overTall.violations[0]?.parentID).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('judgeMove', () =>
{
    // cycle prevention applies to real parent edges; a move to the root can never form a cycle.
    it('admits a move to the root', () =>
    {
        const result = judgeMove({
            nodeID: 'folder_a',
            newParentID: null,
            parentAncestorIDs: [],
        });

        expect(result.ok).toBe(true);
    });

    // a node may not become its own parent.
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

    // a node may not be moved beneath one of its own descendants -- it appears in the destination's ancestor chain.
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

    // a move into an unrelated folder (the node is nowhere in the destination's ancestry) forms no cycle.
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
    // an owner may trash a node they own.
    it('admits an owner trashing their own file', () =>
    {
        const result = judgeTrash({
            node: file({ ownerID: 'user_owner' }),
            actorID: 'user_owner',
        });

        expect(result.ok).toBe(true);
    });

    // links are deleted directly, never trashed.
    it('rejects trashing a link', () =>
    {
        const result = judgeTrash({
            node: link({ ownerID: 'user_recipient' }),
            actorID: 'user_recipient',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('trash.linkNotTrashable');
    });

    // recipients cannot trash nodes they don't own.
    it('rejects trashing a node the actor does not own', () =>
    {
        const result = judgeTrash({
            node: file({ ownerID: 'user_owner' }),
            actorID: 'user_other',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('trash.notOwner');
    });

    // a link is never trashable and only the owner may trash -- a non-owner trashing someone else's link violates both.
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

describe('judgeCopy', () =>
{
    // save-a-copy is a file operation: a file references exactly one blob to point the copy at.
    it('admits copying a file', () =>
    {
        const result = judgeCopy({ source: file() });

        expect(result.ok).toBe(true);
    });

    // a folder roots a subtree with no single blob to copy.
    it('rejects copying a folder', () =>
    {
        const result = judgeCopy({ source: folder() });

        expect(result.ok).toBe(false);
        expect(codes(result)).toEqual([ 'copy.sourceNotFile' ]);
    });

    // a link is an inert pointer carrying no bytes of its own.
    it('rejects copying a link', () =>
    {
        const result = judgeCopy({ source: link() });

        expect(result.ok).toBe(false);
        expect(codes(result)).toEqual([ 'copy.sourceNotFile' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
