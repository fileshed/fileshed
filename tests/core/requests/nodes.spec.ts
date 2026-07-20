//----------------------------------------------------------------------------------------------------------------------
// Node DTOs -- sort-key vocabulary, patch shape, create discrimination, and the role field on every node response
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    type Node,
    childrenQueryCodec,
    createNodeRequestCodec,
    nodeResponseCodec,
    patchNodeRequestCodec,
    toNodeResponse,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('childrenQueryCodec', () =>
{
    // The sortKey vocabulary is a closed set -- name, size, createdAt, updatedAt -- not an arbitrary column
    // name a client could use to probe the schema.
    it('rejects a sort key outside the published vocabulary', () =>
    {
        const result = childrenQueryCodec.safeParse({ sortKey: 'ownerEmail' });

        expect(result.success).toBe(false);
    });

    it('defaults limit, offset, and sort when the query supplies none of them', () =>
    {
        const result = childrenQueryCodec.parse({});

        expect(result).toEqual({ limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc' });
    });

    it('rejects a limit above the page-size ceiling rather than silently truncating it', () =>
    {
        const result = childrenQueryCodec.safeParse({ limit: '500' });

        expect(result.success).toBe(false);
    });
});

describe('nodeResponseCodec', () =>
{
    const base = {
        id: 'node_1',
        name: 'Photos',
        ownerID: 'user_1',
        parentID: null,
        type: 'folder' as const,
        trashedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };

    // every node-returning endpoint includes the caller's effective role, and it must be a real Role ('owner' |
    // 'editor' | 'viewer'), not an arbitrary string a handler forgot to compute correctly.
    it('requires role to be a valid Role', () =>
    {
        const valid = nodeResponseCodec.safeParse({ ...base, role: 'editor' });
        const invalid = nodeResponseCodec.safeParse({ ...base, role: 'superuser' });

        expect(valid.success).toBe(true);
        expect(invalid.success).toBe(false);
    });

    it('rejects a response with no role at all', () =>
    {
        const result = nodeResponseCodec.safeParse(base);

        expect(result.success).toBe(false);
    });
});

describe('createNodeRequestCodec', () =>
{
    // links are plain node CRUD through the same POST /api/nodes as folders, discriminated by type -- a folder create
    // must not admit link-only fields.
    it('discriminates a folder create from a link create by type', () =>
    {
        const folder = createNodeRequestCodec.safeParse({ type: 'folder', name: 'Photos', parentID: null });
        const link = createNodeRequestCodec.safeParse({ type: 'link', parentID: null, targetNodeID: 'node_1' });

        expect(folder.success).toBe(true);
        expect(link.success).toBe(true);
    });

    // Wire-loose, parsed-invariant: an absent parentID means root on create, but the PARSED value is always present
    // (string | null) so the server never sees undefined. Explicit null stays legal. Contrast with PATCH, where absent
    // and null mean different things and no default applies.
    it('defaults an absent parentID to root on create, yielding an invariant parsed shape', () =>
    {
        const folder = createNodeRequestCodec.safeParse({ type: 'folder', name: 'Photos' });

        expect(folder.success).toBe(true);
        expect(folder.data?.parentID).toBeNull();
    });

    it('rejects a folder create carrying a link-only targetNodeID', () =>
    {
        const result = createNodeRequestCodec.safeParse({
            type: 'folder',
            name: 'Photos',
            parentID: null,
            targetNodeID: 'node_1',
        });

        expect(result.success).toBe(false);
    });
});

describe('patchNodeRequestCodec', () =>
{
    // The rename/move PATCH shares one endpoint; a patch that does neither isn't a request.
    it('rejects a patch with neither a name nor a parentID', () =>
    {
        const result = patchNodeRequestCodec.safeParse({});

        expect(result.success).toBe(false);
    });

    it('accepts a patch that only moves, and one that only renames', () =>
    {
        const move = patchNodeRequestCodec.safeParse({ parentID: 'node_2' });
        const rename = patchNodeRequestCodec.safeParse({ name: 'New Name' });

        expect(move.success).toBe(true);
        expect(rename.success).toBe(true);
    });
});

describe('toNodeResponse', () =>
{
    const createdAt = new Date('2026-02-03T04:05:06.000Z');
    const updatedAt = new Date('2026-02-03T04:05:07.000Z');

    // dates cross the boundary as ISO strings, and the caller's effective role rides every node payload. The serializer
    // is the single place both happen, and its output must satisfy the wire codec.
    it('attaches the effective role and serializes dates to ISO strings', () =>
    {
        const folder : Node = {
            type: 'folder',
            id: 'n1',
            name: 'Docs',
            ownerID: 'u1',
            parentID: null,
            createdAt,
            updatedAt,
            trashedAt: null,
        };

        const response = toNodeResponse(folder, 'owner');

        expect(response).toMatchObject({
            type: 'folder',
            id: 'n1',
            role: 'owner',
            createdAt: '2026-02-03T04:05:06.000Z',
            updatedAt: '2026-02-03T04:05:07.000Z',
        });
        expect(nodeResponseCodec.safeParse(response).success).toBe(true);
    });

    // a link resolves its target for display -- id, type, name, and for a file target its size
    // and mime type, so the client can render it without a second fetch.
    it('resolves a link\'s file target to id, type, name, size, and mime type', () =>
    {
        const link : Node = {
            type: 'link',
            id: 'l1',
            name: 'Shared Photo',
            ownerID: 'u1',
            parentID: null,
            createdAt,
            updatedAt,
            targetNodeID: 't1',
        };
        const target : Node = {
            type: 'file',
            id: 't1',
            name: 'photo.jpg',
            ownerID: 'u2',
            parentID: null,
            createdAt,
            updatedAt,
            blobID: 'sha',
            size: 2048,
            mimeType: 'image/jpeg',
            trashedAt: null,
        };

        const response = toNodeResponse(link, 'owner', target);

        expect(response.type).toBe('link');
        if(response.type === 'link')
        {
            expect(response.target).toEqual({
                id: 't1',
                type: 'file',
                name: 'photo.jpg',
                size: 2048,
                mimeType: 'image/jpeg',
            });
        }
    });

    // an unresolvable link (target gone, or access lost) carries a null target so the client renders it as a stub.
    it('serializes a link with a null target when the target is unresolved', () =>
    {
        const link : Node = {
            type: 'link',
            id: 'l1',
            name: 'Was Shared',
            ownerID: 'u1',
            parentID: null,
            createdAt,
            updatedAt,
            targetNodeID: 'gone',
        };

        const response = toNodeResponse(link, 'owner');

        expect(response.type).toBe('link');
        if(response.type === 'link') { expect(response.target).toBeNull(); }
    });
});

//----------------------------------------------------------------------------------------------------------------------
