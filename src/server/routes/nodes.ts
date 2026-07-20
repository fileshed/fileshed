//----------------------------------------------------------------------------------------------------------------------
// Node Routes
//
// The /api/nodes surface: read a node, list a folder's children (or the root), create folders and links, rename/move,
// trash, restore, and permanently delete. Every handler resolves the caller through the session manager (401 when
// absent) and validates the body/query against the core DTO codecs (400 on a shape mismatch); all other outcomes -- not
// found, forbidden, regulation violations -- bubble as typed manager errors that onError maps. The route composes
// managers and carries no error-shape or business logic of its own.
//----------------------------------------------------------------------------------------------------------------------

import { type Context, Hono } from 'hono';
import type { ZodType } from 'zod';

// Models
import { BadRequestError, childrenQueryCodec, createNodeRequestCodec, patchNodeRequestCodec } from '@fileshed/core';

// Managers
import type { NodeManager } from '../managers/node.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { readJsonBody } from './readJsonBody.ts';

//----------------------------------------------------------------------------------------------------------------------

function parseQuery<T>(ctx : Context, codec : ZodType<T>) : T
{
    const result = codec.safeParse(ctx.req.query());
    if(!result.success) { throw new BadRequestError('The query parameters are invalid.'); }

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------

export function createNodeRoutes(sessions : SessionManager, nodes : NodeManager) : Hono
{
    const router = new Hono();

    // Root listing (parentID null). A static first segment, so it resolves ahead of GET /:id for the literal path.
    router.get('/children', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const query = parseQuery(ctx, childrenQueryCodec);

        return ctx.json(await nodes.children(actor, null, query));
    });

    router.get('/:id/children', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const query = parseQuery(ctx, childrenQueryCodec);

        return ctx.json(await nodes.children(actor, ctx.req.param('id'), query));
    });

    router.get('/:id', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await nodes.get(actor, ctx.req.param('id')));
    });

    router.post('/', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const request = await readJsonBody(ctx, createNodeRequestCodec);

        const created = request.type === 'folder'
            ? await nodes.createFolder(actor, request)
            : await nodes.createLink(actor, request);

        return ctx.json(created, 201);
    });

    router.patch('/:id', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        const patch = await readJsonBody(ctx, patchNodeRequestCodec);

        return ctx.json(await nodes.patch(actor, ctx.req.param('id'), patch));
    });

    router.post('/:id/trash', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await nodes.trash(actor, ctx.req.param('id')));
    });

    router.post('/:id/restore', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await nodes.restore(actor, ctx.req.param('id')));
    });

    router.delete('/:id', async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);
        await nodes.hardDelete(actor, ctx.req.param('id'));

        return ctx.body(null, 204);
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
