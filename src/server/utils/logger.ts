//----------------------------------------------------------------------------------------------------------------------
// Logger
//----------------------------------------------------------------------------------------------------------------------

import { type Logger, pino } from 'pino';

//----------------------------------------------------------------------------------------------------------------------

const level = process.env['LOG_LEVEL'] ?? 'info';
const isProduction = process.env['NODE_ENV'] === 'production';

// pino-pretty is an in-process stream, not a transport: pino looks a transport target up by name from its caller's
// file, and module code that Vite's dev runner evaluates has no file name on its call site. It is a dev dependency, so
// only the non-production branch may import it.
const rootLogger = isProduction
    ? pino({ level })
    : pino({ level }, (await import('pino-pretty')).default({ colorize: true }));

//----------------------------------------------------------------------------------------------------------------------

export function getLogger(name : string) : Logger
{
    return rootLogger.child({ name });
}

//----------------------------------------------------------------------------------------------------------------------
