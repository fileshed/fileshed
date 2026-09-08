//----------------------------------------------------------------------------------------------------------------------
// Archive Download — a selection served back as one file
//
// Drives the real endpoint against the real store, then opens what came back with the system's own unzip and tar.
// That is the assertion worth making: an archive nobody's tools can open is not an archive, and no amount of
// asserting our own bytes back at ourselves would notice.
//
// The layout rules themselves are the engine's and are tested there against every shape; what these cover is the
// round trip -- authorization applied per node, folders recursed, links followed to what they point at, the manifest
// written when something was left out, and both formats readable.
//----------------------------------------------------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import {
    type BootedServeApp,
    ORIGIN,
    type TestUser,
    bootServeApp,
    createFolder,
    createNodeLink,
    makeUser,
    shareWith,
    trashNode,
    uploadFile,
} from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const run = promisify(execFile);

let booted : BootedServeApp;
let owner : TestUser;
let scratch : string;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    scratch = await mkdtemp(join(tmpdir(), 'fileshed-archive-'));
});

afterEach(async () =>
{
    await booted.cleanup();
    await rm(scratch, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

async function getArchive(user : TestUser | null, ids : string[], format = 'zip') : Promise<Response>
{
    const params = new URLSearchParams({ ids: ids.join(','), format });

    return booted.app.request(`${ ORIGIN }/api/archives?${ params.toString() }`, {
        headers: user === null ? {} : { cookie: user.cookie },
    });
}

// The archive on disk, so the system's own tools can be asked what is in it.
async function saveArchive(res : Response, name : string) : Promise<string>
{
    const path = join(scratch, name);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));

    return path;
}

// What unzip says is inside, directories included, as it would tell anybody.
async function zipEntries(path : string) : Promise<string[]>
{
    const { stdout } = await run('unzip', [ '-Z1', path ]);

    return stdout.split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .sort();
}

async function tarEntries(path : string) : Promise<string[]>
{
    const { stdout } = await run('tar', [ '-tzf', path ]);

    return stdout.split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .sort();
}

// One entry's bytes, read back out of the zip the way anybody would read them.
async function zipEntryBytes(path : string, entry : string) : Promise<string>
{
    const { stdout } = await run('unzip', [ '-p', path, entry ]);

    return stdout;
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/archives', () =>
{
    it('refuses an anonymous request with 401', async () =>
    {
        const file = await uploadFile(booted, owner, Buffer.from('hello'), { name: 'a.txt' });

        expect((await getArchive(null, [ file.node.id ])).status).toBe(401);
    });

    it('refuses an empty selection with 400', async () =>
    {
        const res = await booted.app.request(`${ ORIGIN }/api/archives?ids=&format=zip`, {
            headers: { cookie: owner.cookie },
        });

        expect(res.status).toBe(400);
    });

    it('refuses a format it does not build with 400', async () =>
    {
        const file = await uploadFile(booted, owner, Buffer.from('hello'), { name: 'a.txt' });

        expect((await getArchive(owner, [ file.node.id ], '7z')).status).toBe(400);
    });

    it('answers 404 when the selection names nothing that exists', async () =>
    {
        expect((await getArchive(owner, [ 'no-such-node' ])).status).toBe(404);
    });

    //------------------------------------------------------------------------------------------------------------------
    // The round trip
    //------------------------------------------------------------------------------------------------------------------

    it('serves a zip the system can open, carrying the file it was asked for', async () =>
    {
        const file = await uploadFile(booted, owner, Buffer.from('the contents'), { name: 'notes.txt' });

        const res = await getArchive(owner, [ file.node.id ]);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/zip');

        const path = await saveArchive(res, 'one.zip');

        expect(await zipEntries(path)).toEqual([ 'notes.txt' ]);
        expect(await zipEntryBytes(path, 'notes.txt')).toBe('the contents');
    });

    it('serves a tgz the system can open', async () =>
    {
        const file = await uploadFile(booted, owner, Buffer.from('the contents'), { name: 'notes.txt' });

        const res = await getArchive(owner, [ file.node.id ], 'tgz');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/gzip');

        expect(await tarEntries(await saveArchive(res, 'one.tgz'))).toEqual([ 'notes.txt' ]);
    });

    // The archive is built as it is sent, so its size is not known when the headers go out.
    it('sends no content-length, having none to send', async () =>
    {
        const file = await uploadFile(booted, owner, Buffer.from('hello'), { name: 'a.txt' });

        const res = await getArchive(owner, [ file.node.id ]);

        expect(res.headers.get('content-length')).toBeNull();

        // Drained even though the assertion is about a header: the archive is still being built behind this
        // response, and leaving it running into the next test's teardown is noise, not a finding.
        await res.arrayBuffer();
    });

    it('names the archive after a single selected node, and after nothing in particular otherwise', async () =>
    {
        const one = await uploadFile(booted, owner, Buffer.from('a'), { name: 'notes.txt' });
        const two = await uploadFile(booted, owner, Buffer.from('b'), { name: 'other.txt' });

        const single = await getArchive(owner, [ one.node.id ]);
        expect(single.headers.get('content-disposition')).toContain('notes.txt.zip');
        await single.arrayBuffer();

        const many = await getArchive(owner, [ one.node.id, two.node.id ]);
        expect(many.headers.get('content-disposition')).toContain('fileshed-selection.zip');
        await many.arrayBuffer();
    });

    it('recurses a folder, mirroring the tree inside the archive', async () =>
    {
        const top = await createFolder(booted, owner, 'Reports');
        const inner = await createFolder(booted, owner, '2026', top.id);
        await uploadFile(booted, owner, Buffer.from('q1'), { name: 'q1.pdf', parentID: top.id });
        await uploadFile(booted, owner, Buffer.from('q2'), { name: 'q2.pdf', parentID: inner.id });

        const path = await saveArchive(await getArchive(owner, [ top.id ]), 'tree.zip');

        expect(await zipEntries(path)).toEqual([
            'Reports/',
            'Reports/2026/',
            'Reports/2026/q2.pdf',
            'Reports/q1.pdf',
        ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // What is left out, and the note that says so
    //------------------------------------------------------------------------------------------------------------------

    // Per-node authorization: the archive is exactly what the caller could have downloaded one file at a time.
    it('leaves out a node the caller cannot read, and names it in the manifest', async () =>
    {
        const stranger = await makeUser(booted, 'stranger@example.com');

        const own = await uploadFile(booted, stranger, Buffer.from('mine'), { name: 'own.txt' });
        const shared = await uploadFile(booted, owner, Buffer.from('lent'), { name: 'shared.txt' });
        const hidden = await uploadFile(booted, owner, Buffer.from('secret'), { name: 'hidden.txt' });

        await shareWith(booted, owner, shared.node.id, stranger.id, 'viewer');

        const res = await getArchive(stranger, [ own.node.id, shared.node.id, hidden.node.id ]);
        const path = await saveArchive(res, 'partial.zip');

        expect(await zipEntries(path)).toEqual([ 'SKIPPED.txt', 'own.txt', 'shared.txt' ]);
        expect(await zipEntryBytes(path, 'SKIPPED.txt')).toContain('hidden.txt');

        // A viewer's grant is enough to be in the archive, which is the whole role gate: what they could have
        // downloaded one at a time is what they get in one file.
        expect(await zipEntryBytes(path, 'shared.txt')).toBe('lent');
    });

    it('says nothing about omissions when everything went in', async () =>
    {
        const file = await uploadFile(booted, owner, Buffer.from('all of it'), { name: 'a.txt' });

        const path = await saveArchive(await getArchive(owner, [ file.node.id ]), 'whole.zip');

        expect(await zipEntries(path)).toEqual([ 'a.txt' ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Links, followed to what they point at
    //------------------------------------------------------------------------------------------------------------------

    // A link is a placement; the bytes are the target's. Someone archiving a folder full of links should get the
    // files, not a folder full of nothing.
    it('follows a link to its file, carrying the target\'s bytes under the link\'s name', async () =>
    {
        const folder = await createFolder(booted, owner, 'Placements');
        const target = await uploadFile(booted, owner, Buffer.from('the real contents'), { name: 'real.txt' });
        await createNodeLink(booted, owner, target.node.id, folder.id, 'shortcut.txt');

        const path = await saveArchive(await getArchive(owner, [ folder.id ]), 'links.zip');

        expect(await zipEntries(path)).toEqual([ 'Placements/', 'Placements/shortcut.txt' ]);
        expect(await zipEntryBytes(path, 'Placements/shortcut.txt')).toBe('the real contents');
    });

    // The link is not what is being read; the thing it points at is. A caller who can reach the link but not its
    // target gets the same answer they would get asking for the target directly.
    it('judges a link on the target\'s access, and names the target when it refuses', async () =>
    {
        const stranger = await makeUser(booted, 'stranger@example.com');

        // The link and the folder holding it are shared; what the link POINTS AT is not. Reading the link is not
        // reading the target, and the archive has to know the difference.
        const secret = await uploadFile(booted, owner, Buffer.from('not for you'), { name: 'secret.txt' });
        const folder = await createFolder(booted, owner, 'Shared');
        await createNodeLink(booted, owner, secret.node.id, folder.id, 'peek.txt');
        await shareWith(booted, owner, folder.id, stranger.id, 'viewer');

        const path = await saveArchive(await getArchive(stranger, [ folder.id ]), 'refused.zip');

        expect(await zipEntries(path)).toEqual([ 'SKIPPED.txt', 'Shared/' ]);
        expect(await zipEntryBytes(path, 'SKIPPED.txt')).toContain('secret.txt');
    });

    it('leaves out a trashed file inside a live folder, and names it', async () =>
    {
        const folder = await createFolder(booted, owner, 'Docs');
        await uploadFile(booted, owner, Buffer.from('kept'), { name: 'kept.txt', parentID: folder.id });
        const binned = await uploadFile(booted, owner, Buffer.from('gone'), {
            name: 'binned.txt',
            parentID: folder.id,
        });
        await trashNode(booted, owner, binned.node.id);

        const path = await saveArchive(await getArchive(owner, [ folder.id ]), 'trashed.zip');
        const entries = await zipEntries(path);

        expect(entries).toContain('Docs/kept.txt');
        expect(entries).not.toContain('Docs/binned.txt');
        expect(await zipEntryBytes(path, 'SKIPPED.txt')).toContain('Docs/binned.txt');
    });
});

//----------------------------------------------------------------------------------------------------------------------
