//----------------------------------------------------------------------------------------------------------------------
// Mail Manager
//
// Outgoing email over admin-tunable SMTP. Every send reads the settings at send time, so a changed server, port, or
// password applies to the next email with no restart. Mail is configured exactly when SMTP_HOST and SMTP_FROM are
// both set; the auth-flow senders (password reset, verification) quietly refuse when it isn't -- better-auth only
// calls them because a flow asked, and an unconfigured instance has nothing to send with -- while the admin
// test-send throws the real reason, transport errors included, because the admin is there to fix them.
//----------------------------------------------------------------------------------------------------------------------

import { BadRequestError, DEFAULT_SMTP_PORT, ForbiddenError } from '@fileshed/core';

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

// A setting that is actually set. Shared by the send path and the configured check so the two can never disagree on
// what "mail is set up" means.
function isFilled(value : unknown) : value is string
{
    return typeof value === 'string' && value !== '';
}

//----------------------------------------------------------------------------------------------------------------------

export class MailManager
{
    readonly #settings : SettingsManager;
    readonly #mail : MailRA;

    constructor(deps : MailManagerDeps)
    {
        this.#settings = deps.settings;
        this.#mail = deps.mail;
    }

    // Resolved per send, like every other mail knob: renaming the instance renames the next email, no restart.
    async #instanceName() : Promise<string>
    {
        const name = await this.#settings.value('INSTANCE_NAME');

        return typeof name === 'string' && name !== '' ? name : 'FileShed';
    }

    // The effective SMTP values at this moment, or null while mail is off (no host or no from address).
    async #smtpValues() : Promise<SmtpValues | null>
    {
        const [ host, port, secure, user, password, from ] = await Promise.all([
            this.#settings.value('SMTP_HOST'),
            this.#settings.numberValue('SMTP_PORT', DEFAULT_SMTP_PORT),
            this.#settings.booleanValue('SMTP_SECURE', false),
            this.#settings.value('SMTP_USER'),
            this.#settings.value('SMTP_PASSWORD'),
            this.#settings.value('SMTP_FROM'),
        ]);

        if(!isFilled(host) || !isFilled(from)) { return null; }

        return {
            host,
            port,
            secure,
            user: isFilled(user) ? user : null,
            password: isFilled(password) ? password : null,
            from,
        };
    }

    // Reads only the two settings that decide the answer, never the credentials. The stored password is encrypted, so
    // resolving it decrypts a secret into memory -- unacceptable on the read-only surfaces that ask this question
    // (the sign-in page's instance banner, the admin overview) merely to render "Configured".
    async isConfigured() : Promise<boolean>
    {
        const [ host, from ] = await Promise.all([
            this.#settings.value('SMTP_HOST'),
            this.#settings.value('SMTP_FROM'),
        ]);

        return isFilled(host) && isFilled(from);
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
    // whether the send worked or not (enumeration and timing), so failures land in the log for the operator. The
    // message is composed against the instance name, which is itself a live settings read.
    #sendQuietly(
        to : string,
        failure : string,
        compose : (name : string) => { subject : string; text : string }
    ) : void
    {
        this.#instanceName()
            .then((name) =>
            {
                const { subject, text } = compose(name);

                return this.#send(to, subject, text);
            })
            .catch((error : unknown) => logger.error({ err: error, to }, failure));
    }

    sendPasswordReset(to : string, url : string) : void
    {
        this.#sendQuietly(to, 'password reset email failed', (name) => ({
            subject: `Reset your ${ name } password`,
            text: `Someone asked to reset the ${ name } password for this address. If that was you, open this `
                + `link to choose a new one:\n\n${ url }\n\nIf it wasn't you, ignore this email; nothing changes `
                + 'without the link.',
        }));
    }

    sendVerification(to : string, url : string) : void
    {
        this.#sendQuietly(to, 'verification email failed', (name) => ({
            subject: `Verify your ${ name } email address`,
            text: `Open this link to verify your email address for ${ name }:\n\n${ url }`,
        }));
    }

    // The admin's plumbing check: sends to the admin's own address and lets every failure -- unconfigured SMTP or a
    // transport refusal -- surface with its real message, because the admin is the one person who can act on it.
    async sendTest(actor : SessionUser) : Promise<{ to : string }>
    {
        if(actor.role !== 'admin') { throw new ForbiddenError('Admin access is required.'); }

        const name = await this.#instanceName();

        try
        {
            await this.#send(
                actor.email,
                `${ name } test email`,
                `This is a test email from ${ name }. If you are reading it, outgoing email works.`
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
