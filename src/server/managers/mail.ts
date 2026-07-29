//----------------------------------------------------------------------------------------------------------------------
// Mail Manager
//
// Outgoing email over admin-tunable SMTP. Every send reads the settings at send time, so a changed server, port, or
// password applies to the next email with no restart. Mail is configured exactly when SMTP_HOST and SMTP_FROM are
// both set; the auth-flow senders (password reset, verification) quietly refuse when it isn't -- better-auth only
// calls them because a flow asked, and an unconfigured instance has nothing to send with -- while the admin
// test-send throws the real reason, transport errors included, because the admin is there to fix them.
//----------------------------------------------------------------------------------------------------------------------

import { BadRequestError, ForbiddenError } from '@fileshed/core';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { MailRA } from '../resource-access/mail/index.ts';

// Managers
import type { SettingsManager } from './settings.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('mail');

export interface MailManagerDeps
{
    settings : SettingsManager;
    mail : MailRA;
    appName : string;
}

interface SmtpValues
{
    host : string;
    port : number;
    secure : boolean;
    user : string | null;
    password : string | null;
    from : string;
}

//----------------------------------------------------------------------------------------------------------------------

export class MailManager
{
    readonly #settings : SettingsManager;
    readonly #mail : MailRA;
    readonly #appName : string;

    constructor(deps : MailManagerDeps)
    {
        this.#settings = deps.settings;
        this.#mail = deps.mail;
        this.#appName = deps.appName;
    }

    // The effective SMTP values at this moment, or null while mail is off (no host or no from address).
    async #smtpValues() : Promise<SmtpValues | null>
    {
        const [ host, port, secure, user, password, from ] = await Promise.all([
            this.#settings.value('SMTP_HOST'),
            this.#settings.numberValue('SMTP_PORT', 587),
            this.#settings.booleanValue('SMTP_SECURE', false),
            this.#settings.value('SMTP_USER'),
            this.#settings.value('SMTP_PASSWORD'),
            this.#settings.value('SMTP_FROM'),
        ]);

        if(typeof host !== 'string' || host === '' || typeof from !== 'string' || from === '') { return null; }

        return {
            host,
            port,
            secure,
            user: typeof user === 'string' && user !== '' ? user : null,
            password: typeof password === 'string' && password !== '' ? password : null,
            from,
        };
    }

    async isConfigured() : Promise<boolean>
    {
        return await this.#smtpValues() !== null;
    }

    async #send(to : string, subject : string, text : string) : Promise<void>
    {
        const smtp = await this.#smtpValues();
        if(smtp === null)
        {
            throw new BadRequestError('Email is not configured: set at least an SMTP host and a from address.');
        }

        await this.#mail.send({ ...smtp, to, subject, text });
    }

    // The auth-flow senders never throw into the flow that triggered them: a reset request must answer identically
    // whether the send worked or not (enumeration and timing), so failures land in the log for the operator.
    sendPasswordReset(to : string, url : string) : void
    {
        this.#send(
            to,
            `Reset your ${ this.#appName } password`,
            `Someone asked to reset the ${ this.#appName } password for this address. If that was you, open this `
                + `link to choose a new one:\n\n${ url }\n\nIf it wasn't you, ignore this email; nothing changes `
                + 'without the link.'
        ).catch((error : unknown) => logger.error({ err: error, to }, 'password reset email failed'));
    }

    sendVerification(to : string, url : string) : void
    {
        this.#send(
            to,
            `Verify your ${ this.#appName } email address`,
            `Open this link to verify your email address for ${ this.#appName }:\n\n${ url }`
        ).catch((error : unknown) => logger.error({ err: error, to }, 'verification email failed'));
    }

    // The admin's plumbing check: sends to the admin's own address and lets every failure -- unconfigured SMTP or a
    // transport refusal -- surface with its real message, because the admin is the one person who can act on it.
    async sendTest(actor : SessionUser) : Promise<{ to : string }>
    {
        if(actor.role !== 'admin') { throw new ForbiddenError('Admin access is required.'); }

        try
        {
            await this.#send(
                actor.email,
                `${ this.#appName } test email`,
                `This is a test email from ${ this.#appName }. If you are reading it, outgoing email works.`
            );
        }
        catch(error)
        {
            if(error instanceof BadRequestError) { throw error; }

            const reason = error instanceof Error ? error.message : String(error);
            throw new BadRequestError(`The SMTP server refused the send: ${ reason }`);
        }

        return { to: actor.email };
    }
}

//----------------------------------------------------------------------------------------------------------------------
