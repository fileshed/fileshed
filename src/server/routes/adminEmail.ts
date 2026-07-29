//----------------------------------------------------------------------------------------------------------------------
// Admin Email Routes
//
// The plumbing check for outgoing mail: one admin-only action that sends to the caller's own address with the
// SMTP settings as they stand right now, so a misconfiguration surfaces here instead of in a user's password-reset
// flow.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Managers
import type { MailManager } from '../managers/mail.ts';
import type { SessionManager } from '../managers/session.ts';

// Routes
import { testEmailSpec } from './adminEmail.openapi.ts';

//----------------------------------------------------------------------------------------------------------------------

export function createAdminEmailRoutes(sessions : SessionManager, mail : MailManager) : Hono
{
    const router = new Hono();

    router.post('/admin/email/test', testEmailSpec, async (ctx) =>
    {
        const actor = await sessions.requireUser(ctx.req.raw.headers);

        return ctx.json(await mail.sendTest(actor));
    });

    return router;
}

//----------------------------------------------------------------------------------------------------------------------
