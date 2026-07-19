//----------------------------------------------------------------------------------------------------------------------
// Dev Env Loading
//
// Vite's loadEnv() resolves .env values but never writes them to process.env, so the in-process Hono dev server
// (which reads config via loadConfig() -> process.env) would otherwise see a different environment than
// `npm run dev:server`. loadViteEnv() bridges the two; existing environment variables always win over .env.
//----------------------------------------------------------------------------------------------------------------------

import { loadEnv } from 'vite';

//----------------------------------------------------------------------------------------------------------------------

export function applyEnvDefaults(env : Record<string, string>, target : NodeJS.ProcessEnv = process.env) : void
{
    for(const [ key, value ] of Object.entries(env))
    {
        target[key] ??= value;
    }
}

export function loadViteEnv(mode : string, envDir : string) : Record<string, string>
{
    const env = loadEnv(mode, envDir, '');
    applyEnvDefaults(env);

    return env;
}

//----------------------------------------------------------------------------------------------------------------------
