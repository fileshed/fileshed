//----------------------------------------------------------------------------------------------------------------------
// Setup API DTOs
//
// The first-run wizard's contract. /api/instance is anonymous by design -- the pre-auth pages (sign-in, setup) need
// it before any session exists -- and carries only facts that are safe in anyone's hands. The setup request carries
// the one-time code the console printed (or the operator-provided automation token); the admin's password crosses
// the wire exactly once, here, and lands only as a hash.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ColorMode } from '../instanceTheme.ts';
import type { SocialProviderID } from '../instanceSettings.ts';

//----------------------------------------------------------------------------------------------------------------------

// The branding facts pre-auth pages need: the instance's display name, the color-mode policy, and the uploaded
// logo's hash (null = the stock mark; the client builds /api/branding/logo?v=<hash> from it, so the URL busts
// itself on every change). Colors travel separately as /api/branding.css -- this is only what requires
// client-side behavior.
export interface InstanceBranding
{
    instanceName : string;
    mode : ColorMode;
    forcedMode : boolean;
    logo : string | null;
}

export interface InstanceResponse
{
    needsSetup : boolean;

    // Whether this instance accepts self-service sign-ups; the sign-up page hides itself when not.
    signUpEnabled : boolean;

    // Whether outgoing email is configured; the sign-in page offers "Forgot password?" only when it is.
    emailEnabled : boolean;

    // The OAuth providers the RUNNING instance registered at boot -- the sign-in page's provider buttons.
    providers : SocialProviderID[];

    // Read live, unlike the boot-frozen facts above: name and mode changes apply on the next load, no restart.
    branding : InstanceBranding;
}

export interface SetupRequest
{
    token : string;
    name : string;
    email : string;
    password : string;
}

export interface SetupResponse
{
    email : string;
}

//----------------------------------------------------------------------------------------------------------------------
