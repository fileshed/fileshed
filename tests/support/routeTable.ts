//----------------------------------------------------------------------------------------------------------------------
// Server Route Table
//
// The composed app's full wire surface, as a method and a Hono path pattern. The server route-table spec asserts the
// app registers exactly this list, and the client endpoints spec asserts every path a resource-access call issues is on
// it, so a route renamed on one side fails the other.
//----------------------------------------------------------------------------------------------------------------------

export const SERVER_ROUTES : readonly string[] = [
    // Auth (better-auth's delegated subtree)
    'GET /api/auth/*',
    'POST /api/auth/*',

    // Admin
    'GET /api/admin/users',
    'PATCH /api/admin/users/:id',
    'DELETE /api/admin/users/:id',
    'POST /api/admin/users/:id/ban',
    'POST /api/admin/users/:id/unban',
    'POST /api/admin/users/:id/role',
    'POST /api/admin/users/:id/password',
    'POST /api/admin/users/:id/revoke-sessions',
    'GET /api/admin/status',
    'POST /api/admin/sweeps/:sweep/run',
    'GET /api/admin/settings',
    'PATCH /api/admin/settings',
    'POST /api/admin/email/test',
    'GET /api/admin/branding',
    'PATCH /api/admin/branding',
    'POST /api/admin/branding/logo',
    'DELETE /api/admin/branding/logo',

    // Health
    'GET /api/health',

    // Version (session-only)
    'GET /api/version',

    // Instance & first-run setup (anonymous by design)
    'GET /api/instance',
    'POST /api/setup',
    'GET /api/branding.css',
    'GET /api/branding/logo',

    // Blobs (claim / proof-of-possession)
    'POST /api/blobs/claim',
    'POST /api/blobs/claim/:challengeID',

    // Uploads
    'PUT /api/uploads/:ticket',

    // Me
    'GET /api/me',
    'PATCH /api/me/preferences',
    'POST /api/me/deletion',
    'DELETE /api/me/deletion',
    'POST /api/me/revoke-credentials',

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
    'GET /api/archives',

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

    // The OpenAPI document. The interactive reference that renders it is deliberately absent: a deployment never
    // mounts it, and this list is the wire surface a deployment has.
    'GET /api/openapi.json',
];

//----------------------------------------------------------------------------------------------------------------------
