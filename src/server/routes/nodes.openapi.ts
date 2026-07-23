//----------------------------------------------------------------------------------------------------------------------
// Node Route OpenAPI Specs
//
// Documentation-only middleware for the /api/nodes surface, colocated with the handlers it describes and spread into
// the route registrations as a single token each. Every status a spec lists is one the handler or node manager
// actually produces; the read-as-absent doctrine (no access, or trashed and not owned, is a 404 indistinguishable from
// a missing node) is stated where it applies.
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import {
    childrenQueryCodec,
    copyNodeRequestCodec,
    createNodeRequestCodec,
    deleteNodeQueryCodec,
    emptyTrashResponseCodec,
    nodeListResponseCodec,
    nodeResponseCodec,
    patchNodeRequestCodec,
    purgeBrokenLinksResponseCodec,
} from '@fileshed/core';

// Routes
import { emptyResponse, errorResponse, jsonBody, jsonResponse, pathParam, queryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const NODE_TAG = 'Nodes';

const nodeIDParam = pathParam('id', 'The node ID.');

//----------------------------------------------------------------------------------------------------------------------

export const getNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Get a node by ID',
    description: 'Returns the node the caller can reach at this ID, with their effective role attached. A node the '
        + 'caller cannot read -- absent, unreachable, or trashed and not owned by them -- is reported as 404, never '
        + 'distinguished from one that never existed.',
    parameters: [ nodeIDParam ],
    responses: {
        200: jsonResponse('The node, with the caller\'s effective role.', nodeResponseCodec),
        401: errorResponse('No session.'),
        404: errorResponse('No node is readable at this ID.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const rootChildrenSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'List the caller\'s root',
    description: 'Lists the caller\'s own root -- the nodes they own that have no parent -- one page at a time. Each '
        + 'carries the caller\'s effective role; the root is scoped to the caller, so contributions other owners '
        + 'placed here do not appear.',
    parameters: queryParams(childrenQueryCodec),
    responses: {
        200: jsonResponse('A page of root nodes.', nodeListResponseCodec),
        400: errorResponse('The query parameters are invalid.'),
        401: errorResponse('No session.'),
    },
});

export const childrenSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'List a folder\'s children',
    description: 'Lists a folder\'s children regardless of who owns them, so contributions other users placed inside '
        + 'travel with the folder. Each child carries the caller\'s effective role. A folder the caller cannot read, '
        + 'or one trashed and not owned by them, is 404.',
    parameters: [ nodeIDParam, ...queryParams(childrenQueryCodec) ],
    responses: {
        200: jsonResponse('A page of the folder\'s children.', nodeListResponseCodec),
        400: errorResponse('The query parameters are invalid.'),
        401: errorResponse('No session.'),
        404: errorResponse('No folder is readable at this ID.'),
    },
});

export const listTrashSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'List the caller\'s trash',
    description: 'Lists the roots of the caller\'s trashed subtrees, one page at a time, paged and sorted like a '
        + 'folder listing. A trashed folder lists once; the items inside it travel with it and never list separately. '
        + 'Only the caller\'s own trashed nodes appear, each with the owner role.',
    parameters: queryParams(childrenQueryCodec),
    responses: {
        200: jsonResponse('A page of the caller\'s trashed roots.', nodeListResponseCodec),
        400: errorResponse('The query parameters are invalid.'),
        401: errorResponse('No session.'),
    },
});

export const emptyTrashSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Empty the trash',
    description: 'Permanently deletes every root of the caller\'s own trashed subtrees, each through the same '
        + 'subtree-delete and blob-graveyard path a single permanent delete takes, and reports how many roots were '
        + 'purged. Only the caller\'s own trash is ever touched; an already-empty trash is a harmless no-op.',
    responses: {
        200: jsonResponse('The number of trashed roots purged.', emptyTrashResponseCodec),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const createNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Create a folder or link',
    description: 'Creates a folder or a link under the given parent (or the caller\'s root when parentID is omitted); '
        + 'the discriminated body selects which. Placing under a parent needs owner or editor access to it. A link '
        + 'needs read access to its target and cannot point at another link.',
    requestBody: jsonBody(createNodeRequestCodec),
    responses: {
        201: jsonResponse('The created node.', nodeResponseCodec),
        400: errorResponse('The request body does not match the expected shape.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller may not place a node here, or may not link to the target.'),
        404: errorResponse('The parent, or a link\'s target, does not exist.'),
        422: errorResponse('The request is well-formed but violates a placement or linking rule.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const patchNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Rename and/or move a node',
    description: 'Renames and/or moves a node, owner-only. The body must change at least one of name or parent. A move '
        + 'is refused if it would cycle the tree, and a placement under another owner\'s folder is forbidden.',
    parameters: [ nodeIDParam ],
    requestBody: jsonBody(patchNodeRequestCodec),
    responses: {
        200: jsonResponse('The updated node.', nodeResponseCodec),
        400: errorResponse('The request body does not match the expected shape, or renames and moves nothing.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node, or may not place it under the new parent.'),
        404: errorResponse('The node, or the new parent, does not exist.'),
        422: errorResponse('The move would cycle the tree.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const trashNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Trash a node',
    description: 'Moves a node and its whole subtree to the trash, owner-only. A trashed node becomes absent to '
        + 'everyone but its owner. Links are removed outright rather than trashed.',
    parameters: [ nodeIDParam ],
    responses: {
        200: jsonResponse('The trashed node.', nodeResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
        422: errorResponse('A link cannot be trashed.'),
    },
});

export const restoreNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Restore a trashed node',
    description: 'Restores a trashed node and its subtree, owner-only. It returns to its original parent, or to the '
        + 'caller\'s root when that parent is gone or still trashed.',
    parameters: [ nodeIDParam ],
    responses: {
        200: jsonResponse('The restored node.', nodeResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const copyNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Save a copy of a file',
    description: 'Saves an independent copy of a file as a new node the caller owns, sharing the source\'s content so '
        + 'no bytes move, charged to the caller\'s quota. Viewer access to the source suffices; the caller must own or '
        + 'have editor access to the destination parent.',
    parameters: [ nodeIDParam ],
    requestBody: jsonBody(copyNodeRequestCodec),
    responses: {
        201: jsonResponse('The copy, a fresh file node owned by the caller.', nodeResponseCodec),
        400: errorResponse('The request body does not match the expected shape.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller may not place the copy here, or it would exceed their quota.'),
        404: errorResponse('The source is unreachable, or the destination parent does not exist.'),
        422: errorResponse('The source is not a file.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const purgeBrokenLinksSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Purge broken links in a folder',
    description: 'Removes the caller\'s own dead links inside a folder -- links whose target they can no longer '
        + 'resolve -- and reports how many were purged. Read access to the folder is enough; only the caller\'s own '
        + 'placements are ever touched.',
    parameters: [ nodeIDParam ],
    responses: {
        200: jsonResponse('The number of links purged.', purgeBrokenLinksResponseCodec),
        401: errorResponse('No session.'),
        404: errorResponse('No folder is readable at this ID.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const deleteNodeSpec = describeRoute({
    tags: [ NODE_TAG ],
    summary: 'Permanently delete a node',
    description: 'Permanently deletes a node and its subtree, owner-only. With offerCopies=true, each recipient who '
        + 'could still see a deleted file through a share is offered a save-a-copy before the bytes are reclaimed; the '
        + 'flag is ignored for folder deletes.',
    parameters: [ nodeIDParam, ...queryParams(deleteNodeQueryCodec) ],
    responses: {
        204: emptyResponse('The node was deleted.'),
        400: errorResponse('The query parameters are invalid.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
