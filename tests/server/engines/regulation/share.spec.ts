//----------------------------------------------------------------------------------------------------------------------
// Share Regulation -- grant legality and share-request resolution
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import type { FileNode, LinkNode, PendingShareRequest, ResolvedShareRequest } from '@fileshed/core';

// Regulation
import type { RegulationResult } from '@server/engines/regulation/types.ts';
import { judgeGrant, judgeShareRequestResolution } from '@server/engines/regulation/share.ts';

//----------------------------------------------------------------------------------------------------------------------

const AT = new Date('2026-01-01T00:00:00.000Z');

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

function pendingRequest(overrides : Partial<PendingShareRequest> = {}) : PendingShareRequest
{
    return {
        status: 'pending',
        id: 'req_1',
        nodeID: 'file_1',
        requesterID: 'user_requester',
        requestedRole: 'viewer',
        resolvedAt: null,
        createdAt: AT,
        ...overrides,
    };
}

function resolvedRequest(overrides : Partial<ResolvedShareRequest> = {}) : ResolvedShareRequest
{
    return {
        status: 'granted',
        id: 'req_1',
        nodeID: 'file_1',
        requesterID: 'user_requester',
        requestedRole: 'viewer',
        resolvedAt: AT,
        createdAt: AT,
        ...overrides,
    };
}

function codes(result : RegulationResult) : string[]
{
    return result.ok ? [] : result.violations.map((violation) => violation.code);
}

//----------------------------------------------------------------------------------------------------------------------

describe('judgeGrant', () =>
{
    // shares can only be created by the node's owner (v1), granting access to another user.
    it('admits an owner granting a viewer share to another user', () =>
    {
        const result = judgeGrant({
            node: file({ ownerID: 'user_owner' }),
            granterID: 'user_owner',
            granteeID: 'user_grantee',
            role: 'viewer',
        });

        expect(result.ok).toBe(true);
    });

    // only the owner creates shares in v1 -- editors cannot re-share.
    it('rejects a grant created by someone who is not the owner', () =>
    {
        const result = judgeGrant({
            node: file({ ownerID: 'user_owner' }),
            granterID: 'user_editor',
            granteeID: 'user_grantee',
            role: 'editor',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('share.notOwner');
    });

    // links carry no ACL of their own; every check resolves against the target, so a link is not shareable.
    it('rejects a grant on a link node', () =>
    {
        const result = judgeGrant({
            node: link({ ownerID: 'user_owner' }),
            granterID: 'user_owner',
            granteeID: 'user_grantee',
            role: 'viewer',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('share.linkNotShareable');
    });

    // a share confers access, not ownership; granting the owner a share on their own node is meaningless and rejected.
    it('rejects the owner granting a share to themselves', () =>
    {
        const result = judgeGrant({
            node: file({ ownerID: 'user_owner' }),
            granterID: 'user_owner',
            granteeID: 'user_owner',
            role: 'editor',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('share.granteeIsOwner');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('judgeShareRequestResolution', () =>
{
    // requests route to the target's owner, who grants or declines them.
    it('admits the target owner resolving a pending request', () =>
    {
        const result = judgeShareRequestResolution({
            request: pendingRequest(),
            targetOwnerID: 'user_owner',
            actorID: 'user_owner',
        });

        expect(result.ok).toBe(true);
    });

    // resolution authority belongs to the target's owner, never the folder sharer.
    it('rejects resolution by someone other than the target owner', () =>
    {
        const result = judgeShareRequestResolution({
            request: pendingRequest(),
            targetOwnerID: 'user_owner',
            actorID: 'user_folder_sharer',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('shareRequest.notOwner');
    });

    // granting/declining resolves a request; an already-resolved request cannot be resolved again.
    it('rejects resolving an already-resolved request', () =>
    {
        const result = judgeShareRequestResolution({
            request: resolvedRequest({ status: 'granted', resolvedAt: AT }),
            targetOwnerID: 'user_owner',
            actorID: 'user_owner',
        });

        expect(result.ok).toBe(false);
        expect(codes(result)).toContain('shareRequest.notPending');
    });
});

//----------------------------------------------------------------------------------------------------------------------
