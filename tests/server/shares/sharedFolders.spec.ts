//----------------------------------------------------------------------------------------------------------------------
// True shared folders
//
// The defining behavior of the feature: a user with editor on a folder may create files and subfolders inside it, the
// new node is owned by the CREATOR (so quota charges them), and its parent is the folder owner's node -- the one
// sanctioned cross-owner edge. A viewer may not create. Both create paths are covered: POST /api/nodes (folders) and
// the blob upload commit (files). Not the implementation.
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
    uploadSmallFile,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

let booted : BootedShareApp;
let owner : TestUser;
let editor : TestUser;
let viewer : TestUser;
let folder : string;

beforeEach(async () =>
{
    booted = await bootShareApp();
    owner = await makeUser(booted, 'owner@example.com');
    editor = await makeUser(booted, 'editor@example.com');
    viewer = await makeUser(booted, 'viewer@example.com');

    folder = await createFolder(booted.app, owner.cookie, 'Team');
    await grantShare(booted.app, owner.cookie, folder, editor.id, 'editor');
    await grantShare(booted.app, owner.cookie, folder, viewer.id, 'viewer');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------
// Node-create path (POST /api/nodes)
//----------------------------------------------------------------------------------------------------------------------

describe('creating a subfolder inside a shared folder', () =>
{
    it('lets an editor create a subfolder owned by the editor under the folder owner\'s node', async () =>
    {
        const res = await request(
            booted.app, 
            'POST', 
            '/api/nodes', 
            editor.cookie,
            { type: 'folder', name: 'Drafts', parentID: folder }
        );
        const body = await res.json() as Json;

        expect(res.status).toBe(201);
        // Owner is the creator (quota charges them); parent points into the folder owner's subtree.
        expect(body).toMatchObject({ type: 'folder', name: 'Drafts', ownerID: editor.id, parentID: folder });
    });

    it('lets the folder owner read the editor\'s contribution via ancestor ownership', async () =>
    {
        const created = await (await request(
            booted.app, 
            'POST', 
            '/api/nodes', 
            editor.cookie,
            { type: 'folder', name: 'Drafts', parentID: folder }
        )).json() as Json;

        const ownerRead = await request(booted.app, 'GET', `/api/nodes/${ created.id }`, owner.cookie);

        expect(ownerRead.status).toBe(200);
        expect((await ownerRead.json() as Json).role).toBe('owner');
    });

    it('refuses a viewer creating a subfolder inside the shared folder', async () =>
    {
        const res = await request(
            booted.app, 
            'POST', 
            '/api/nodes', 
            viewer.cookie,
            { type: 'folder', name: 'Nope', parentID: folder }
        );
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'parent.crossOwner')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Blob upload path (PUT /api/uploads/:ticket)
//----------------------------------------------------------------------------------------------------------------------

describe('uploading a file into a shared folder', () =>
{
    it('lets an editor upload a file owned by the editor into the shared folder', async () =>
    {
        const res = await uploadSmallFile(booted.app, editor.cookie, Buffer.from('editor bytes'), folder);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        // The uploaded file is owned by the uploader and charged to their quota, inside the folder owner's subtree.
        expect(body).toMatchObject({ type: 'file', ownerID: editor.id, parentID: folder });
    });

    it('refuses a viewer uploading a file into the shared folder', async () =>
    {
        const res = await uploadSmallFile(booted.app, viewer.cookie, Buffer.from('viewer bytes'), folder);
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'parent.crossOwner')).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The folder owner's view of a contribution
//
// The contribution is owned by the editor but lives in the owner's folder. The owner holds no share on the file itself,
// so their access can only come from owning an ancestor of it -- the folder. It travels with the folder.
//----------------------------------------------------------------------------------------------------------------------

async function contribute(name = 'contribution.bin') : Promise<string>
{
    const res = await uploadSmallFile(booted.app, editor.cookie, Buffer.from('editor bytes'), folder, name);
    const body = await res.json() as Json;

    return body.id as string;
}

describe('the folder owner and a foreign-owned contribution', () =>
{
    it('lists the contribution among the folder\'s children with role owner', async () =>
    {
        await contribute();

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/children`, owner.cookie);
        const body = await res.json() as { nodes : { name : string; ownerID : string; role : string }[] };

        const contribution = body.nodes.find((node) => node.name === 'contribution.bin');
        expect(contribution).toBeDefined();
        expect(contribution?.ownerID).toBe(editor.id);
        expect(contribution?.role).toBe('owner');
    });

    it('reads the contribution directly with role owner', async () =>
    {
        const contributionID = await contribute();

        const res = await request(booted.app, 'GET', `/api/nodes/${ contributionID }`, owner.cookie);

        expect(res.status).toBe(200);
        expect((await res.json() as Json).role).toBe('owner');
    });

    it('keeps the contribution hidden from a stranger with no access to the folder', async () =>
    {
        const stranger = await makeUser(booted, 'stranger@example.com');
        const contributionID = await contribute();

        const res = await request(booted.app, 'GET', `/api/nodes/${ contributionID }`, stranger.cookie);

        expect(res.status).toBe(404);
    });

    // The distinction isDirectOwner exists to name: the folder owner RESOLVES 'owner' on the contribution and may read
    // it (ancestor ownership), but administering it -- sharing, trashing -- is direct ownership, which they do
    // not have. Resolved role answers access; authority over a node is a different question.
    it('refuses the folder owner sharing a contribution they do not own', async () =>
    {
        const contributionID = await contribute();
        const outsider = await makeUser(booted, 'outsider@example.com');

        const read = await request(booted.app, 'GET', `/api/nodes/${ contributionID }`, owner.cookie);
        const res = await grantShare(booted.app, owner.cookie, contributionID, outsider.id, 'viewer');
        const body = await res.json() as { violations ?: { code : string }[] };

        // Reads as owner ...
        expect((await read.json() as Json).role).toBe('owner');
        // ... but cannot re-share what it does not own.
        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'share.notOwner')).toBe(true);
    });

    it('refuses the folder owner trashing a contribution they do not own', async () =>
    {
        const contributionID = await contribute();

        const res = await request(booted.app, 'POST', `/api/nodes/${ contributionID }/trash`, owner.cookie);
        const body = await res.json() as { violations ?: { code : string }[] };

        expect(res.status).toBe(403);
        expect(body.violations?.some((violation) => violation.code === 'trash.notOwner')).toBe(true);
    });

    it('gives the contributor owner on their own file in a folder where they are only an editor', async () =>
    {
        await contribute();

        const res = await request(booted.app, 'GET', `/api/nodes/${ folder }/children`, editor.cookie);
        const body = await res.json() as { nodes : { name : string; role : string }[] };

        // Ownership of the child outranks the editor role inherited from the folder.
        expect(body.nodes.find((node) => node.name === 'contribution.bin')?.role).toBe('owner');
    });

    // Revoking the contributor's access leaves their items in the folder. They lose the folder, but they still
    // OWN the file they contributed (their quota is charged for it until it is deleted).
    it('leaves the contributor owning their file after their folder access is revoked', async () =>
    {
        const contributionID = await contribute();
        const grantsRes = await request(booted.app, 'GET', `/api/nodes/${ folder }/shares`, owner.cookie);
        const grants = await grantsRes.json() as { shares : { id : string; granteeUserID : string }[] };
        const editorGrant = grants.shares.find((share) => share.granteeUserID === editor.id);

        await request(booted.app, 'DELETE', `/api/shares/${ editorGrant?.id }`, owner.cookie);

        const folderRead = await request(booted.app, 'GET', `/api/nodes/${ folder }`, editor.cookie);
        const fileRead = await request(booted.app, 'GET', `/api/nodes/${ contributionID }`, editor.cookie);

        expect(folderRead.status).toBe(404);
        expect(fileRead.status).toBe(200);
        expect((await fileRead.json() as Json).role).toBe('owner');
    });
});

//----------------------------------------------------------------------------------------------------------------------
