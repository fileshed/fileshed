//----------------------------------------------------------------------------------------------------------------------
// Node Routes
//
// The /api/nodes surface: read a node, list a folder's children (or the root), create folders and links, rename/move,
// trash, restore, and permanently delete. Reads sit on the access-token plane demanding files:read and writes
// files:write; the two irreversible endpoints -- permanent delete and empty-trash -- stay session-only by design, so
// no token, whatever its scopes, can destroy content beyond restoring reach. Bodies and queries validate against the
// core DTO codecs (400 on a shape mismatch); all other outcomes -- not found, forbidden, regulation violations --
// bubble as typed manager errors that onError maps. The route composes managers and carries no error-shape or
// business logic of its own.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Models
import {
    childrenQueryCodec,
    copyNodeRequestCodec,
    createNodeRequestCodec,
    deleteNodeQueryCodec,
    patchNodeRequestCodec,
    permissionDemands,
} from '@fileshed/core';

// Managers
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import {
    childrenSpec,
    copyNodeSpec,
    createNodeSpec,
    deleteNodeSpec,
    emptyTrashSpec,
    getNodeSpec,
    listTrashSpec,
    patchNodeSpec,
    purgeBrokenLinksSpec,
    restoreNodeSpec,
    rootChildrenSpec,
    trashNodeSpec,
} from './nodes.openapi.ts';
import { parseQuery } from './parseQuery.ts';
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createNodeRoutes(sessions : SessionManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    // The caller's Trash view: their trashed subtree roots, owner-scoped, paged and sorted like a folder listing.
    router.get('/trash', listTrashSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);
        const query = parseQuery(ctx, childrenQueryCodec);

        return ctx.json(await nodes.listTrash(actor.user, query));
    });

    // Permanently purge every one of the caller's own trashed subtree roots in one call. Irreversible, so
    // session-only: access tokens cannot empty a trash.
    router.delete('/trash', emptyTrashSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await nodes.emptyTrash(actor));
    });

    // Root listing (parentID null). A static segment, so it resolves ahead of GET /nodes/:id for the literal path.
    router.get('/nodes/children', rootChildrenSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);
        const query = parseQuery(ctx, childrenQueryCodec);

        return ctx.json(await nodes.children(actor.user, null, query));
    });

    router.get('/nodes/:id/children', childrenSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);
        const query = parseQuery(ctx, childrenQueryCodec);

        return ctx.json(await nodes.children(actor.user, ctx.req.param('id'), query));
    });

    router.get('/nodes/:id', getNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesRead);

        return ctx.json(await nodes.get(actor.user, ctx.req.param('id')));
    });

    router.post('/nodes', createNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);
        const request = await readJsonBody(ctx, createNodeRequestCodec);

        const created = request.type === 'folder'
            ? await nodes.createFolder(actor.user, request)
            : await nodes.createLink(actor.user, request);

        return ctx.json(created, 201);
    });

    router.patch('/nodes/:id', patchNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);
        const patch = await readJsonBody(ctx, patchNodeRequestCodec);

        return ctx.json(await nodes.patch(actor.user, ctx.req.param('id'), patch));
    });

    router.post('/nodes/:id/trash', trashNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        return ctx.json(await nodes.trash(actor.user, ctx.req.param('id')));
    });

    router.post('/nodes/:id/restore', restoreNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        return ctx.json(await nodes.restore(actor.user, ctx.req.param('id')));
    });

    router.post('/nodes/:id/copy', copyNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);
        const request = await readJsonBody(ctx, copyNodeRequestCodec);

        return ctx.json(await nodes.copy(actor.user, ctx.req.param('id'), request), 201);
    });

    router.post('/nodes/:id/purge-broken-links', purgeBrokenLinksSpec, async (ctx) =>
    {
        const actor = await sessions.requireActor(ctx.req.raw.headers, permissionDemands.filesWrite);

        return ctx.json(await nodes.purgeBrokenLinks(actor.user, ctx.req.param('id')));
    });

    // Irreversible, so session-only: access tokens cannot permanently delete.
    router.delete('/nodes/:id', deleteNodeSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const query = parseQuery(ctx, deleteNodeQueryCodec);
        await nodes.hardDelete(actor, ctx.req.param('id'), { offerCopies: query.offerCopies });

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
