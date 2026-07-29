//----------------------------------------------------------------------------------------------------------------------
// App Route Table
//
// The composed app's full wire surface, pinned. Route files own their full paths and every feature router mounts at
// /api, so nothing structural stops two files claiming the same method+path -- this spec is that backstop, and its
// expected table is the reviewable URL map: adding, moving, or removing a route must show up in this diff.
//
// Only terminal handlers count. A describeRoute doc spec is a per-route middleware, and Hono records every handler in a
// route's chain as its own entry in app.routes, so a decorated route carries a second entry at the same method+path.
// Middleware takes (ctx, next) -- arity 2 -- while a terminal handler takes (ctx); filtering on arity keeps exactly the
// terminal registrations, so the invariant this table asserts is that no two TERMINAL handlers share a method+path.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { NodeRA } from '@server/resource-access/nodes/node.ts';
import { PublicLinkRA } from '@server/resource-access/publicLinks/index.ts';
import { ShareRA } from '@server/resource-access/shares/index.ts';
import { MediaTagsRA } from '@server/resource-access/mediaTags/index.ts';
import { UserRA } from '@server/resource-access/users/index.ts';
import { MailRA } from '@server/resource-access/mail/index.ts';
import { SettingsRA } from '@server/resource-access/settings/index.ts';
import { createAuth } from '@server/resource-access/auth.ts';
import { createDatabase } from '@server/resource-access/database/database.ts';

// Managers
import { AvatarManager } from '@server/managers/avatar.ts';
import { BlobManager } from '@server/managers/blob.ts';
import { DeletionOfferManager } from '@server/managers/deletionOffer.ts';
import { NodeManager } from '@server/managers/node.ts';
import { PublicLinkManager } from '@server/managers/publicLink.ts';
import { ShareManager } from '@server/managers/share.ts';
import { StatusManager } from '@server/managers/status.ts';
import { LastRunTracker } from '@server/managers/lastRun.ts';
import { AdminManager } from '@server/managers/admin.ts';
import { MailManager } from '@server/managers/mail.ts';
import { MediaTagManager } from '@server/managers/mediaTags.ts';
import { SettingsManager } from '@server/managers/settings.ts';
import { SetupManager } from '@server/managers/setup.ts';
import { UserManager } from '@server/managers/user.ts';

// Utils
import { SecretBox } from '@server/utils/secretBox.ts';

// App
import { createApp } from '@server/app.ts';

// Support
import { testConfig } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const EXPECTED_ROUTES = [
    // Auth (better-auth's delegated subtree)
    'GET /api/auth/*',
    'POST /api/auth/*',

    // Admin
    'GET /api/admin/users',
    'PATCH /api/admin/users/:id',
    'POST /api/admin/users/:id/ban',
    'POST /api/admin/users/:id/unban',
    'POST /api/admin/users/:id/role',
    'POST /api/admin/users/:id/password',
    'POST /api/admin/users/:id/revoke-sessions',
    'GET /api/admin/status',
    'GET /api/admin/settings',
    'PATCH /api/admin/settings',
    'POST /api/admin/email/test',

    // Health
    'GET /api/health',

    // Instance & first-run setup (anonymous by design)
    'GET /api/instance',
    'POST /api/setup',

    // Blobs (claim / proof-of-possession)
    'POST /api/blobs/claim',
    'POST /api/blobs/claim/:challengeID',

    // Uploads
    'PUT /api/uploads/:ticket',

    // Me
    'GET /api/me',
    'PATCH /api/me/preferences',

    // Access tokens (the only key-management surface; the plugin's own endpoints are gated shut)
    'POST /api/me/access-tokens',
    'GET /api/me/access-tokens',
    'DELETE /api/me/access-tokens/:id',
    'POST /api/me/playback-token',

    // Users
    'GET /api/users/lookup',

    // Avatars
    'POST /api/me/avatar',
    'DELETE /api/me/avatar',
    'GET /api/avatars/:sha256',

    // Nodes
    'GET /api/trash',
    'DELETE /api/trash',
    'GET /api/nodes/children',
    'GET /api/nodes/:id/children',
    'GET /api/nodes/:id',
    'POST /api/nodes',
    'PATCH /api/nodes/:id',
    'POST /api/nodes/:id/trash',
    'POST /api/nodes/:id/restore',
    'POST /api/nodes/:id/copy',
    'POST /api/nodes/:id/purge-broken-links',
    'DELETE /api/nodes/:id',

    // Search
    'GET /api/search',

    // Shares
    'POST /api/nodes/:id/shares',
    'GET /api/nodes/:id/shares',
    'GET /api/shared-with-me',
    'POST /api/shares/:id/leave',
    'DELETE /api/shares/:id',

    // Access requests
    'POST /api/nodes/:id/access-requests',
    'GET /api/access-requests',
    'POST /api/access-requests/:id/grant',
    'POST /api/access-requests/:id/decline',

    // Downloads (authenticated)
    'GET /api/nodes/:id/download',

    // Deletion offers
    'GET /api/deletion-offers',
    'POST /api/deletion-offers/:id/accept',
    'POST /api/deletion-offers/:id/decline',

    // Public links (management)
    'POST /api/nodes/:id/links',
    'GET /api/nodes/:id/links',
    'DELETE /api/links/:id',

    // Direct serving (anonymous, deliberately outside /api)
    'GET /d/:token',

    // OpenAPI documentation
    'GET /api/openapi.json',
    'GET /api/docs',
];

//----------------------------------------------------------------------------------------------------------------------

// Route registration is pure composition -- no request is ever served, so the database never needs migrating and the
// storage root is never touched.
const config = testConfig();
const handle = createDatabase(config);
const auth = createAuth(handle, config);

const blob = new BlobRA(handle);
const nodeRA = new NodeRA(handle);
const shareRA = new ShareRA(handle);
const userRA = new UserRA(handle);

const nodes = new NodeManager(handle, nodeRA, blob);
const settings = new SettingsManager({
    settings: new SettingsRA(handle),
    config,
    box: new SecretBox(config.AUTH_SECRET),
    startedAt: new Date(),
});

const app = createApp(auth, {
    blobs: new BlobManager({ handle, blob, uploadMaxBytes: async () => config.UPLOAD_MAX_BYTES }),
    mediaTags: new MediaTagManager({ blob, tags: new MediaTagsRA(handle) }),
    setup: new SetupManager({ auth, handle, users: userRA, operatorToken: null }),
    avatars: new AvatarManager({ handle, blob, avatarMaxBytes: async () => config.AVATAR_MAX_BYTES }),
    nodes,
    shares: new ShareManager(handle, nodeRA, shareRA, userRA),
    publicLinks: new PublicLinkManager(nodeRA, blob, new PublicLinkRA(handle), (userID, nodeID) =>
        shareRA.effectiveRole(userID, nodeID)),
    deletionOffers: new DeletionOfferManager(handle, nodes),
    adminStatus: new StatusManager(blob, new LastRunTracker()),
    users: new UserManager(userRA),
    settings,
    admins: new AdminManager({ auth, usage: (ownerIDs) => nodeRA.ownedBytesByOwner(ownerIDs) }),
    mail: new MailManager({ settings, mail: new MailRA(), appName: 'FileShed' }),
    providers: [],
});

afterAll(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('createApp route table', () =>
{
    // Exact equality catches every failure mode at once: a missing route, an unexpected one, and two routers
    // registering the same method+path (the duplicate appears twice on the actual side). Doc-spec middleware (arity 2)
    // is filtered out so only terminal handlers are compared.
    it('registers exactly the declared wire surface', () =>
    {
        const actual = app.routes
            .filter((route) => route.method !== 'ALL' && route.handler.length < 2)
            .map((route) => `${ route.method } ${ route.path }`);

        expect([ ...actual ].sort()).toEqual([ ...EXPECTED_ROUTES ].sort());
    });
});

//----------------------------------------------------------------------------------------------------------------------
