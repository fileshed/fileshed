//----------------------------------------------------------------------------------------------------------------------
// Node DTOs -- sort-key vocabulary, patch shape, create discrimination, and the role field on every node response
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    MAX_CHILDREN_LIMIT,
    NODE_NAME_MAX_LENGTH,
    type Node,
    childrenQueryCodec,
    copyNodeRequestCodec,
    createNodeRequestCodec,
    linkTargetCodec,
    nodeListResponseCodec,
    nodeResponseCodec,
    nodeSharingCodec,
    patchNodeRequestCodec,
    toNodeResponse,
    userSummaryCodec,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('childrenQueryCodec', () =>
{
    // The sortKey vocabulary is a closed set -- name, size, createdAt, updatedAt, kind -- not an arbitrary column
    // name a client could use to probe the schema.
    it('rejects a sort key outside the published vocabulary', () =>
    {
        const result = childrenQueryCodec.safeParse({ sortKey: 'ownerEmail' });

        expect(result.success).toBe(false);
    });

    // 'kind' joins the vocabulary alongside name/size/createdAt/updatedAt so a listing can sort by node kind.
    it('accepts kind as a sort key', () =>
    {
        const result = childrenQueryCodec.safeParse({ sortKey: 'kind' });

        expect(result.success).toBe(true);
    });

    // An empty query is the unfiltered default: page one, name-ascending, and no type selection (types is present but
    // empty, not absent -- an empty selection means "no type filter").
    it('defaults limit, offset, sort, and an empty type selection when the query supplies none of them', () =>
    {
        const result = childrenQueryCodec.parse({});

        expect(result).toEqual({ limit: 50, offset: 0, sortKey: 'name', sortDirection: 'asc', types: [] });
    });

    it('rejects a limit above the page-size ceiling rather than silently truncating it', () =>
    {
        const result = childrenQueryCodec.safeParse({ limit: String(MAX_CHILDREN_LIMIT + 1) });

        expect(result.success).toBe(false);
    });

    // The client reads a folder a chunk at a time and asks for the largest page there is, so the ceiling itself has
    // to be a limit the endpoint accepts.
    it('accepts a limit at the ceiling', () =>
    {
        const result = childrenQueryCodec.safeParse({ limit: String(MAX_CHILDREN_LIMIT) });

        expect(result.success).toBe(true);
    });

    // Type families ride one comma-separated param, so it must parse back into the family array the server filters on.
    it('parses a comma-separated types param into the family array', () =>
    {
        const result = childrenQueryCodec.parse({ types: 'images,pdfs' });

        expect(result.types).toEqual([ 'images', 'pdfs' ]);
    });

    it('reads an empty types param as an unfiltered (empty) selection', () =>
    {
        expect(childrenQueryCodec.parse({ types: '' }).types).toEqual([]);
    });

    // The families are a closed vocabulary; a token outside it is rejected, not silently dropped, so a typo never
    // quietly widens the listing.
    it('rejects a type family outside the published vocabulary', () =>
    {
        const result = childrenQueryCodec.safeParse({ types: 'images,spreadsheets' });

        expect(result.success).toBe(false);
    });

    it('accepts every published type family', () =>
    {
        const all = 'folders,documents,pdfs,images,video,audio,archives,links';
        const result = childrenQueryCodec.safeParse({ types: all });

        expect(result.success).toBe(true);
    });

    it('accepts an owner filter and an ISO-instant modified window', () =>
    {
        const result = childrenQueryCodec.safeParse({
            ownerID: 'user_1',
            updatedAfter: '2026-01-01T00:00:00.000Z',
            updatedBefore: '2026-02-01T00:00:00.000Z',
        });

        expect(result.success).toBe(true);
    });

    it('rejects a modified bound that is not an ISO instant', () =>
    {
        const result = childrenQueryCodec.safeParse({ updatedAfter: 'last tuesday' });

        expect(result.success).toBe(false);
    });

    // The exact-name filter is optional (a listing without it is unfiltered by name) and, when present, carries the
    // literal name to match -- collision detection reaches for it, so it must survive parsing verbatim.
    it('carries an optional exact-name filter through unchanged', () =>
    {
        const withName = childrenQueryCodec.safeParse({ name: 'report.pdf' });
        const withoutName = childrenQueryCodec.parse({});

        expect(withName.success).toBe(true);
        if(!withName.success) { throw new Error('expected the name filter to parse'); }
        expect(withName.data.name).toBe('report.pdf');
        expect(withoutName.name).toBeUndefined();
    });
});

describe('userSummaryCodec', () =>
{
    const base = { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' };

    // The avatar image is required but nullable -- an account with no avatar carries an explicit null, never an absent
    // key, so a consumer never has to distinguish undefined from null.
    it('accepts a summary with an avatar image and one with a null image', () =>
    {
        expect(userSummaryCodec.safeParse({ ...base, image: 'https://cdn/ada.png' }).success).toBe(true);
        expect(userSummaryCodec.safeParse({ ...base, image: null }).success).toBe(true);
    });

    it('rejects a summary that omits the image field entirely', () =>
    {
        expect(userSummaryCodec.safeParse(base).success).toBe(false);
    });
});

describe('nodeListResponseCodec', () =>
{
    const envelope = { nodes: [], total: 0, limit: 50, offset: 0 };

    // Every listing envelope carries the owner facet, even when empty; a response without owners is not a valid list.
    it('requires the owners facet on the envelope', () =>
    {
        expect(nodeListResponseCodec.safeParse(envelope).success).toBe(false);
        expect(nodeListResponseCodec.safeParse({ ...envelope, owners: [] }).success).toBe(true);
    });

    it('carries owners as user summaries', () =>
    {
        const owner = { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null };
        const result = nodeListResponseCodec.safeParse({ ...envelope, owners: [ owner ] });

        expect(result.success).toBe(true);
    });
});

describe('nodeSharingCodec', () =>
{
    // The two are independent: a node can be granted to people with no public link, published with no grants, or
    // both at once.
    it('accepts grants without a link, a link without grants, and both together', () =>
    {
        expect(nodeSharingCodec.safeParse({ granteeCount: 3, linkUrl: null }).success).toBe(true);
        expect(nodeSharingCodec.safeParse({ granteeCount: 0, linkUrl: '/d/abc' }).success).toBe(true);
        expect(nodeSharingCodec.safeParse({ granteeCount: 1, linkUrl: '/d/abc' }).success).toBe(true);
    });

    // linkUrl is required-but-nullable: "no link" is an explicit null, so a reader never has to tell an absent key
    // from a node that carries no link.
    it('rejects an entry that omits linkUrl entirely', () =>
    {
        expect(nodeSharingCodec.safeParse({ granteeCount: 1 }).success).toBe(false);
    });

    it('rejects a grantee count that is negative or fractional', () =>
    {
        expect(nodeSharingCodec.safeParse({ granteeCount: -1, linkUrl: null }).success).toBe(false);
        expect(nodeSharingCodec.safeParse({ granteeCount: 1.5, linkUrl: null }).success).toBe(false);
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
        sharing: null,
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

describe('linkTargetCodec', () =>
{
    const base = { id: 'node_1', type: 'file' as const, name: 'photo.jpg' };

    // The target's ownerID is who the row belongs to, not the link's -- a link resolves someone else's file, so the
    // wire block naming that display fact is mandatory, not optional.
    it('requires ownerID on a resolved target', () =>
    {
        expect(linkTargetCodec.safeParse(base).success).toBe(false);
        expect(linkTargetCodec.safeParse({ ...base, ownerID: 'user_1' }).success).toBe(true);
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

    // A stored name is returned on every listing of its parent and is what a name-ordered listing sorts by, so an
    // unbounded one is a cost every reader of that folder pays -- including the owner, who cannot delete what they
    // cannot list. An editor on a shared folder may create inside it, so the payer need not be the author.
    it('rejects a folder name past the length ceiling', () =>
    {
        const result = createNodeRequestCodec.safeParse({
            type: 'folder',
            name: 'a'.repeat(NODE_NAME_MAX_LENGTH + 1),
        });

        expect(result.success).toBe(false);
    });

    it('accepts a folder name exactly at the ceiling', () =>
    {
        const result = createNodeRequestCodec.safeParse({
            type: 'folder',
            name: 'a'.repeat(NODE_NAME_MAX_LENGTH),
        });

        expect(result.success).toBe(true);
    });

    it('rejects a link name past the length ceiling', () =>
    {
        const result = createNodeRequestCodec.safeParse({
            type: 'link',
            name: 'a'.repeat(NODE_NAME_MAX_LENGTH + 1),
            targetNodeID: 'node_1',
        });

        expect(result.success).toBe(false);
    });
});

describe('copyNodeRequestCodec', () =>
{
    it('rejects a copy name past the length ceiling', () =>
    {
        const result = copyNodeRequestCodec.safeParse({ name: 'a'.repeat(NODE_NAME_MAX_LENGTH + 1) });

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

    // Rename is the other way an unbounded name reaches storage; capping create alone would leave it wide open.
    it('rejects a rename past the length ceiling', () =>
    {
        const result = patchNodeRequestCodec.safeParse({ name: 'a'.repeat(NODE_NAME_MAX_LENGTH + 1) });

        expect(result.success).toBe(false);
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

        const response = toNodeResponse(folder, { role: 'owner' });

        expect(response).toMatchObject({
            type: 'folder',
            id: 'n1',
            role: 'owner',
            createdAt: '2026-02-03T04:05:06.000Z',
            updatedAt: '2026-02-03T04:05:07.000Z',
        });
        expect(nodeResponseCodec.safeParse(response).success).toBe(true);
    });

    // a link resolves its target for display -- id, type, name, owner, and for a file target its size
    // and mime type, so the client can render it without a second fetch.
    it('resolves a link\'s file target to id, type, name, owner, size, and mime type', () =>
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

        const response = toNodeResponse(link, { role: 'owner', target });

        expect(response.type).toBe('link');
        if(response.type === 'link')
        {
            expect(response.target).toEqual({
                id: 't1',
                type: 'file',
                name: 'photo.jpg',
                ownerID: 'u2',
                size: 2048,
                mimeType: 'image/jpeg',
            });
        }
    });

    // the target's ownerID is who the row belongs to -- distinct from the link's own ownerID, which names the
    // recipient who placed the link, not the person whose file it is.
    it('carries the target\'s own ownerID, not the link\'s, when the two differ', () =>
    {
        const link : Node = {
            type: 'link',
            id: 'l1',
            name: 'Shared Folder',
            ownerID: 'recipient',
            parentID: null,
            createdAt,
            updatedAt,
            targetNodeID: 't1',
        };
        const target : Node = {
            type: 'folder',
            id: 't1',
            name: 'Team Docs',
            ownerID: 'original-owner',
            parentID: null,
            createdAt,
            updatedAt,
            trashedAt: null,
        };

        const response = toNodeResponse(link, { role: 'viewer', target });

        expect(response.type).toBe('link');
        if(response.type === 'link') { expect(response.target?.ownerID).toBe('original-owner'); }
    });

    // an unresolvable link (target gone, or access lost) carries a null target so the client renders it as a stub,
    // with no target owner to fall back on -- the client falls back to the link's own ownerID instead.
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

        const response = toNodeResponse(link, { role: 'owner' });

        expect(response.type).toBe('link');
        if(response.type === 'link') { expect(response.target).toBeNull(); }
    });
});

//----------------------------------------------------------------------------------------------------------------------
