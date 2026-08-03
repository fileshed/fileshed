//----------------------------------------------------------------------------------------------------------------------
// Mail Manager — SMTP over live settings
//
// The contract: mail is configured exactly when SMTP_HOST and SMTP_FROM are both set; every send reads the
// settings at send time, so an admin's patch applies to the next email; the sealed SMTP password leaves the store
// as the plaintext the transport needs (the SecretBox round trip through the settings layer); the admin test-send
// surfaces unconfigured mail and transport refusals as actionable errors; and the auth-flow senders never throw
// into the flow that triggered them.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BadRequestError, ForbiddenError } from '@fileshed/core';

// Resource Access
import type { MailDelivery, MailRA } from '@server/resource-access/mail/index.ts';
import { SettingsRA } from '@server/resource-access/settings/index.ts';

// Managers
import { MailManager } from '@server/managers/mail.ts';
import { SettingsManager } from '@server/managers/settings.ts';

// Utils
import { SecretBox } from '@server/utils/secretBox.ts';

// Support
import { type BootedApp, bootTestApp } from '../auth/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const admin = testActor({ id: 'admin1', role: 'admin', email: 'root@example.com' });
const civilian = testActor({ id: 'user1', role: 'user' });

// The RA boundary as a recorder: deliveries land here instead of a socket, and `refuse` simulates the SMTP server
// rejecting the send.
class RecordingMailRA
{
    readonly deliveries : MailDelivery[] = [];
    refuse : string | null = null;

    // Counts every send the manager reached the transport with, refused or not -- what lets a fire-and-forget send be
    // waited on for its own completion rather than a guessed interval.
    attempts = 0;

    async send(delivery : MailDelivery) : Promise<void>
    {
        this.attempts += 1;

        if(this.refuse !== null) { throw new Error(this.refuse); }

        this.deliveries.push(delivery);
    }
}

let booted : BootedApp;
let settings : SettingsManager;
let transport : RecordingMailRA;
let mail : MailManager;

beforeEach(async () =>
{
    booted = await bootTestApp();
    settings = new SettingsManager({
        settings: new SettingsRA(booted.handle),
        config: booted.config,
        box: new SecretBox(booted.config.AUTH_SECRET),
        startedAt: new Date(),
    });
    transport = new RecordingMailRA();
    mail = new MailManager({ settings, mail: transport as unknown as MailRA });
});

// The auth-flow senders are deliberately fire-and-forget, so a send reaches the transport however many real round
// trips the settings read takes -- a microtask flush would only ever prove the SQLite timing.
async function awaitSendAttempts(count : number) : Promise<void>
{
    await vi.waitFor(() => expect(transport.attempts).toBe(count), { timeout: 5000, interval: 10 });
}

async function configureSmtp() : Promise<void>
{
    await settings.patch(admin, {
        changes: {
            SMTP_HOST: 'smtp.example.com',
            SMTP_FROM: 'shed@example.com',
            SMTP_USER: 'mailer',
            SMTP_PASSWORD: 'hunter2-smtp-secret',
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------

describe('MailManager', () =>
{
    it('is unconfigured until both a host and a from address exist', async () =>
    {
        expect(await mail.isConfigured()).toBe(false);

        await settings.patch(admin, { changes: { SMTP_HOST: 'smtp.example.com' } });
        expect(await mail.isConfigured()).toBe(false);

        await settings.patch(admin, { changes: { SMTP_FROM: 'shed@example.com' } });
        expect(await mail.isConfigured()).toBe(true);
    });

    it('refuses the test-send to a non-admin', async () =>
    {
        await expect(mail.sendTest(civilian)).rejects.toThrow(ForbiddenError);
        expect(transport.deliveries).toHaveLength(0);
    });

    it('tells the admin mail is not configured instead of pretending to send', async () =>
    {
        await expect(mail.sendTest(admin)).rejects.toThrow(/not configured/i);
        expect(transport.deliveries).toHaveLength(0);
    });

    it('brands the very next email with a renamed instance, no restart', async () =>
    {
        await configureSmtp();

        await mail.sendTest(admin);
        expect(transport.deliveries[0]?.subject).toBe('FileShed test email');

        await settings.patch(admin, { changes: { INSTANCE_NAME: 'Vale Files' } });

        await mail.sendTest(admin);
        expect(transport.deliveries[1]?.subject).toBe('Vale Files test email');
    });

    it('delivers the test email with the settings as they stand, sealed password included', async () =>
    {
        await configureSmtp();

        const result = await mail.sendTest(admin);

        expect(result).toEqual({ to: 'root@example.com' });
        const delivery = transport.deliveries[0];
        expect(delivery).toMatchObject({
            host: 'smtp.example.com',
            port: 587,
            secure: false,
            user: 'mailer',
            from: 'shed@example.com',
            to: 'root@example.com',
        });

        // The password crossed the settings store sealed (AES-GCM at rest) and must come back out as the exact
        // plaintext the SMTP server expects.
        expect(delivery?.password).toBe('hunter2-smtp-secret');
        const stored = await new SettingsRA(booted.handle).get('SMTP_PASSWORD');
        expect(String(stored)).toMatch(/^v1:/);
    });

    it('applies a changed server to the very next send, no restart', async () =>
    {
        await configureSmtp();
        await mail.sendTest(admin);

        await settings.patch(admin, { changes: { SMTP_HOST: 'smtp2.example.com', SMTP_PORT: 2525 } });
        await mail.sendTest(admin);

        expect(transport.deliveries[1]).toMatchObject({ host: 'smtp2.example.com', port: 2525 });
    });

    it('surfaces a transport refusal to the admin with its real reason', async () =>
    {
        await configureSmtp();
        transport.refuse = 'Invalid login: 535 Authentication failed';

        await expect(mail.sendTest(admin)).rejects.toThrow(/535 Authentication failed/);
        await expect(mail.sendTest(admin)).rejects.toThrow(BadRequestError);
    });

    it('sends the password-reset email carrying the reset link', async () =>
    {
        await configureSmtp();

        mail.sendPasswordReset('member@example.com', 'https://shed.example.com/reset?token=abc');
        await awaitSendAttempts(1);

        expect(transport.deliveries[0]?.to).toBe('member@example.com');
        expect(transport.deliveries[0]?.text).toContain('https://shed.example.com/reset?token=abc');
    });

    it('never throws unconfigured mail into the auth flow that triggered it', () =>
    {
        expect(() => mail.sendPasswordReset('member@example.com', 'https://x/reset')).not.toThrow();
        expect(() => mail.sendVerification('member@example.com', 'https://x/verify')).not.toThrow();

        // Unconfigured mail never reaches the transport at all, so there is nothing a later moment could deliver.
        expect(transport.deliveries).toHaveLength(0);
    });

    it('never throws a transport refusal into the auth flow that triggered it', async () =>
    {
        await configureSmtp();
        transport.refuse = 'connection refused';

        expect(() => mail.sendPasswordReset('member@example.com', 'https://x/reset')).not.toThrow();
        expect(() => mail.sendVerification('member@example.com', 'https://x/verify')).not.toThrow();
        await awaitSendAttempts(2);

        expect(transport.deliveries).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
