//----------------------------------------------------------------------------------------------------------------------
// Security Policy Warnings
//
// The settings whose wrong value is invisible: nothing fails, nothing logs, and the deployment runs for a year before
// anyone finds out. Each one here is a decision an operator can only make for themselves, so the boot says which way
// it went rather than picking silently.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { ANY_HOST } from '@fileshed/core';

// Utils
import type { Config } from './config.ts';
import { getLogger } from './logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('config');

export interface SecurityWarning
{
    // A stable handle for the finding, so a spec names the case rather than matching prose.
    code : 'any-host' | 'any-origin' | 'insecure-cookies' | 'undecided-proxy-trust' | 'rate-limiting-off';

    message : string;
}

//----------------------------------------------------------------------------------------------------------------------

// The wide-open settings are said wherever they are on, development included. They are the ones a development box
// carries deliberately and a deployment must not, and a process started the wrong way is exactly the case that has to
// announce itself. The rest are production only: a development box is reached over http on a laptop, fronts no proxy,
// and gets hammered by nobody, so warning there would train an operator to scroll past the boot log.
export function securityWarnings(config : Config, env : Record<string, string | undefined>) : SecurityWarning[]
{
    const warnings : SecurityWarning[] = [];

    if(config.ALLOWED_HOSTS.includes(ANY_HOST))
    {
        warnings.push({
            code: 'any-host',
            message: `ALLOWED_HOSTS is ${ ANY_HOST }, so this instance builds its own URLs from whatever Host header `
                + 'a request carries. Anyone who sends a forged one puts their address in the verification and '
                + 'password-reset links this instance emails. List the hosts you answer on, or leave it empty to '
                + 'answer only on BASE_URL\'s.',
        });
    }

    if(config.TRUSTED_ORIGINS.includes(ANY_HOST))
    {
        warnings.push({
            code: 'any-origin',
            message: `TRUSTED_ORIGINS is ${ ANY_HOST }, so a write is accepted from any origin and the cross-site `
                + 'request check refuses nothing. List the origins you answer on, or leave it empty to answer only '
                + 'on BASE_URL.',
        });
    }

    if(env['NODE_ENV'] !== 'production') { return warnings; }

    if(new URL(config.BASE_URL).protocol === 'http:' && !config.ALLOW_INSECURE_COOKIES)
    {
        warnings.push({
            code: 'insecure-cookies',
            message: `BASE_URL is ${ config.BASE_URL }, so session cookies ship without the Secure flag and a `
                + 'browser will send them over plain http. If TLS terminates at a proxy in front of this instance, '
                + 'BASE_URL must be the https URL the browser uses, not the http one the proxy speaks inwards. If '
                + 'this instance really is served over http, set ALLOW_INSECURE_COOKIES=true to say so.',
        });
    }

    if(config.TRUSTED_PROXIES === null)
    {
        warnings.push({
            code: 'undecided-proxy-trust',
            message: 'TRUSTED_PROXIES is not set, so X-Forwarded-For is ignored and every client is identified by '
                + 'the socket it connected on. Behind a reverse proxy that makes every request look like the proxy '
                + 'and puts the whole instance in one rate-limit bucket -- set TRUSTED_PROXIES to the proxy\'s '
                + 'address or range. If nothing fronts this instance, set TRUSTED_PROXIES=none.',
        });
    }

    if(!config.RATE_LIMIT_ENABLED)
    {
        warnings.push({
            code: 'rate-limiting-off',
            message: 'RATE_LIMIT_ENABLED is false. Sign-in, password reset, and the anonymous link routes accept '
                + 'unlimited requests from any client.',
        });
    }

    return warnings;
}

export function logSecurityPolicy(config : Config, env : Record<string, string | undefined>) : void
{
    for(const warning of securityWarnings(config, env))
    {
        logger.warn({ policy: warning.code }, warning.message);
    }
}

//----------------------------------------------------------------------------------------------------------------------
