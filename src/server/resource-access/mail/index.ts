//----------------------------------------------------------------------------------------------------------------------
// Mail Resource Access
//
// The nodemailer facade: one send, one transport, built fresh from the delivery's own connection values. No pooling
// and no cached transport on purpose -- SMTP settings are admin-tunable at runtime, and building per send is what
// makes a changed server apply to the very next email at a cost that is nothing next to the SMTP round trip itself.
//----------------------------------------------------------------------------------------------------------------------

import nodemailer from 'nodemailer';

//----------------------------------------------------------------------------------------------------------------------

export interface MailDelivery
{
    host : string;
    port : number;
    secure : boolean;
    user : string | null;
    password : string | null;
    from : string;
    to : string;
    subject : string;
    text : string;
}

//----------------------------------------------------------------------------------------------------------------------

export class MailRA
{
    async send(delivery : MailDelivery) : Promise<void>
    {
        const transport = nodemailer.createTransport({
            host: delivery.host,
            port: delivery.port,
            secure: delivery.secure,
            ...delivery.user === null ? {} : {
                auth: { user: delivery.user, pass: delivery.password ?? '' },
            },
        });

        try
        {
            await transport.sendMail({
                from: delivery.from,
                to: delivery.to,
                subject: delivery.subject,
                text: delivery.text,
            });
        }
        finally
        {
            transport.close();
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
