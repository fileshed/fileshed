//----------------------------------------------------------------------------------------------------------------------
// Sharing — grant / revoke / leave, Shared with me, and the grantee's view
//
// Drives the sharing HTTP surface end to end through the real stack. Expectations: only a node's owner may share,
// a link carries no ACL, a recipient leaves while an owner revokes, Shared with me lists active shares with
// placement, and every node payload carries the caller's real effective role. Not the implementation.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import {
    type BootedShareApp,
    type TestUser,
    bootShareApp,
    createFolder,
    grantShare,
    makeUser,
    request,
    setAvatarSha256,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

let booted : BootedShareApp;
let owner : TestUser;
let grantee : TestUser;
let stranger : TestUser;

beforeEach(async () =>
{
    booted = await bootShareApp();
    owner = await makeUser(booted, 'owner@example.com');
    grantee = await makeUser(booted, 'grantee@example.com');
    stranger = await makeUser(booted, 'stranger@example.com');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------
// Grant
//----------------------------------------------------------------------------------------------------------------------

describe('POST /api/nodes/:id/shares', () =>
{
    it('lets the owner grant a viewer share, returning the created grant', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');

        const res = await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        expect(body).toMatchObject({ nodeID: folder, granteeUserID: grantee.id, role: 'viewer', createdBy: owner.id });
    });

    it('refuses a grant from a non-owner (only the owner may share)', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');

        const res = await grantShare(booted.app, stranger.cookie, folder, grantee.id, 'viewer');
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'share.notOwner')).toBe(true);
    });

    // A stranger is refused for having no role at all, which would still pass if grant relaxed to editor-or-better.
    // An editor is the case that pins owner-only: they hold the strongest non-owner role and still cannot re-share
    // ("editors can re-share" is a future toggle, not v1).
    it('refuses a grant from an editor on the node (owner-only, not editor-or-better)', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const third = await makeUser(booted, 'third@example.com');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'editor');

        const res = await grantShare(booted.app, grantee.cookie, folder, third.id, 'viewer');
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'share.notOwner')).toBe(true);
    });

    // Read-as-absent: an authorization failure names the rule, never another user. A 403 that carried the
    // owner's id would tell any authenticated caller who owns a node they cannot read.
    it('does not name the owner in a non-owner\'s 403 body', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');

        const res = await grantShare(booted.app, stranger.cookie, folder, grantee.id, 'viewer');
        const raw = await res.text();

        expect(res.status).toBe(403);
        expect(raw).toContain('share.notOwner');
        expect(raw).not.toContain(owner.id);
    });

    it('refuses granting the owner a share on their own node', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');

        const res = await grantShare(booted.app, owner.cookie, folder, owner.id, 'viewer');
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(422);
        expect(body.violations?.some((violation) => violation.code === 'share.granteeIsOwner')).toBe(true);
    });

    it('updates the role in place when re-granting an existing grantee', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const res = await grantShare(booted.app, owner.cookie, folder, grantee.id, 'editor');
        const list = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, owner.cookie);
        const body = await list.json() as { shares : { share : { granteeUserID : string; role : string } }[] };

        expect(res.status).toBe(201);
        expect(body.shares.filter((entry) => entry.share.granteeUserID === grantee.id)).toHaveLength(1);
        expect(body.shares.find((entry) => entry.share.granteeUserID === grantee.id)?.share.role).toBe('editor');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The grantee's access
//----------------------------------------------------------------------------------------------------------------------

describe('effective access of a grantee', () =>
{
    it('lets a viewer read the shared node with role viewer, while a stranger gets 404', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const granteeRead = await request(booted.app, 'GET', `/api/nodes/${ folder }`, grantee.cookie);
        const strangerRead = await request(booted.app, 'GET', `/api/nodes/${ folder }`, stranger.cookie);

        expect(granteeRead.status).toBe(200);
        expect((await granteeRead.json() as Json).role).toBe('viewer');
        expect(strangerRead.status).toBe(404);
    });

    it('stamps the inherited role on each child when a grantee lists a shared folder', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await createFolder(booted.app, owner.cookie, 'inner', folder);
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/children`, grantee.cookie);
        const body = await res.json() as { nodes : { name : string; role : string }[] };

        expect(res.status).toBe(200);
        expect(body.nodes).toHaveLength(1);
        expect(body.nodes[0]).toMatchObject({ name: 'inner', role: 'viewer' });
    });

    // A listed child's role is max(folder role, ownership, its own direct grant) -- a stronger grant on the child must
    // outrank what it inherits from the folder.
    it('lets a child\'s own stronger grant outrank the role inherited from the folder', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const inner = await createFolder(booted.app, owner.cookie, 'inner', folder);
        const plain = await createFolder(booted.app, owner.cookie, 'plain', folder);
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');
        await grantShare(booted.app, owner.cookie, inner, grantee.id, 'editor');

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/children`, grantee.cookie);
        const body = await res.json() as { nodes : { id : string; role : string }[] };

        expect(body.nodes.find((node) => node.id === inner)?.role).toBe('editor');
        // Its sibling, with no grant of its own, still carries the folder's inherited viewer.
        expect(body.nodes.find((node) => node.id === plain)?.role).toBe('viewer');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Revoke and leave
//----------------------------------------------------------------------------------------------------------------------

describe('ending access', () =>
{
    it('lets the owner revoke, after which the grantee can no longer read the node', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const grant = await (await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer')).json() as Json;

        const revoke = await request(booted.app, 'DELETE', `/api/shares/${ grant.id }`, owner.cookie);
        const readAfter = await request(booted.app, 'GET', `/api/nodes/${ folder }`, grantee.cookie);

        expect(revoke.status).toBe(204);
        expect(readAfter.status).toBe(404);
    });

    it('refuses a revoke from someone who is not the node owner', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const grant = await (await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer')).json() as Json;

        const res = await request(booted.app, 'DELETE', `/api/shares/${ grant.id }`, grantee.cookie);

        expect(res.status).toBe(403);
    });

    it('lets the grantee leave their own share, losing access', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const grant = await (await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer')).json() as Json;

        const leave = await request(booted.app, 'POST', `/api/shares/${ grant.id }/leave`, grantee.cookie);
        const readAfter = await request(booted.app, 'GET', `/api/nodes/${ folder }`, grantee.cookie);

        expect(leave.status).toBe(204);
        expect(readAfter.status).toBe(404);
    });

    it('refuses a leave from someone who is not the grantee', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const grant = await (await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer')).json() as Json;

        const res = await request(booted.app, 'POST', `/api/shares/${ grant.id }/leave`, stranger.cookie);

        expect(res.status).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Owner's grant list
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/nodes/:id/shares', () =>
{
    it('refuses to list a node\'s grants for anyone but the owner', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, grantee.cookie);

        expect(res.status).toBe(403);
    });

    it('pairs each grant with its grantee\'s display summary', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, owner.cookie);
        const body = await res.json() as { shares : { share : Json; grantee : Json }[] };

        expect(res.status).toBe(200);
        expect(body.shares).toHaveLength(1);
        expect(body.shares[0]?.share).toMatchObject({ granteeUserID: grantee.id, role: 'viewer' });
        expect(body.shares[0]?.grantee).toEqual({
            id: grantee.id,
            name: grantee.name,
            email: grantee.email,
            image: null,
        });
    });

    it('derives a grantee\'s avatar image URL from their stored avatar hash', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');
        const sha256 = 'bb'.repeat(32);
        await setAvatarSha256(booted, grantee.id, sha256);

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, owner.cookie);
        const body = await res.json() as { shares : { grantee : { image : string | null } }[] };

        expect(body.shares[0]?.grantee.image).toBe(`/api/avatars/${ sha256 }`);
    });

    it('resolves every grantee\'s summary when a node carries more than one grant', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        const third = await makeUser(booted, 'third-list@example.com');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');
        await grantShare(booted.app, owner.cookie, folder, third.id, 'editor');

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, owner.cookie);
        const body = await res.json() as { shares : { grantee : { id : string } }[] };

        expect(body.shares.map((entry) => entry.grantee.id).sort()).toEqual([ grantee.id, third.id ].sort());
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Shared with me
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/shared-with-me', () =>
{
    it('lists the caller\'s active shares with placed=false before they place a link', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'editor');

        const res = await request(booted.app, 'GET', '/api/shared-with-me', grantee.cookie);
        const body = await res.json() as { entries : { target : Json; placed : boolean; share : Json }[] };

        expect(res.status).toBe(200);
        expect(body.entries).toHaveLength(1);
        expect(body.entries[0]?.target).toMatchObject({ id: folder, type: 'folder', ownerID: owner.id });
        expect(body.entries[0]?.placed).toBe(false);
    });

    it('reports placed=true once the grantee places a link to the shared item', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'editor');
        await request(
            booted.app, 
            'POST', 
            '/api/nodes', 
            grantee.cookie,
            { type: 'link', targetNodeID: folder, parentID: null }
        );

        const res = await request(booted.app, 'GET', '/api/shared-with-me', grantee.cookie);
        const body = await res.json() as { entries : { placed : boolean }[] };

        expect(body.entries[0]?.placed).toBe(true);
    });

    it('pairs each entry with the target owner\'s display summary', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const res = await request(booted.app, 'GET', '/api/shared-with-me', grantee.cookie);
        const body = await res.json() as { entries : { owner : Json }[] };

        // The recipient sees the sharer's real name, not just the ownerID already riding on the target -- the owner
        // shared WITH them, so disclosing this summary discloses no one who didn't already disclose themselves.
        expect(body.entries[0]?.owner).toEqual({ id: owner.id, name: owner.name, email: owner.email, image: null });
    });

    it('derives the owner\'s avatar image URL from their stored avatar hash', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');
        const sha256 = 'dd'.repeat(32);
        await setAvatarSha256(booted, owner.id, sha256);

        const res = await request(booted.app, 'GET', '/api/shared-with-me', grantee.cookie);
        const body = await res.json() as { entries : { owner : { image : string | null } }[] };

        expect(body.entries[0]?.owner.image).toBe(`/api/avatars/${ sha256 }`);
    });

    // The Type filter rides the query string and narrows against the target's own type. This proves the param travels
    // parse -> manager -> RA over the wire; the mime-family precision is proven at the manager level.
    it('narrows the listing to shares whose target matches the selected type family', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const asFolders = await request(booted.app, 'GET', '/api/shared-with-me?types=folders', grantee.cookie);
        const asImages = await request(booted.app, 'GET', '/api/shared-with-me?types=images', grantee.cookie);

        const foldersBody = await asFolders.json() as { entries : { target : { id : string } }[] };
        const imagesBody = await asImages.json() as { entries : unknown[] };

        expect(foldersBody.entries.map((entry) => entry.target.id)).toEqual([ folder ]);
        expect(imagesBody.entries).toEqual([]);
    });

    it('bounds the listing by the modified window against the target', async () =>
    {
        const folder = await createFolder(booted.app, owner.cookie, 'Shared');
        await grantShare(booted.app, owner.cookie, folder, grantee.id, 'viewer');

        const futurePath = '/api/shared-with-me?updatedAfter=2999-01-01T00:00:00.000Z';
        const pastPath = '/api/shared-with-me?updatedAfter=2000-01-01T00:00:00.000Z';
        const future = await request(booted.app, 'GET', futurePath, grantee.cookie);
        const past = await request(booted.app, 'GET', pastPath, grantee.cookie);

        expect((await future.json() as { entries : unknown[] }).entries).toEqual([]);
        expect((await past.json() as { entries : { target : { id : string } }[] }).entries
            .map((entry) => entry.target.id)).toEqual([ folder ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
