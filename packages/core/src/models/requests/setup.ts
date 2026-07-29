//----------------------------------------------------------------------------------------------------------------------
// Setup API DTOs
//
// The first-run wizard's contract. /api/instance is anonymous by design -- the pre-auth pages (sign-in, setup) need
// it before any session exists -- and carries only facts that are safe in anyone's hands. The setup request carries
// the one-time code the console printed (or the operator-provided automation token); the admin's password crosses
// the wire exactly once, here, and lands only as a hash.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { SocialProviderID } from '../instanceSettings.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface InstanceResponse
{
    needsSetup : boolean;

    // Whether this instance accepts self-service sign-ups; the sign-up page hides itself when not.
    signUpEnabled : boolean;

    // Whether outgoing email is configured; the sign-in page offers "Forgot password?" only when it is.
    emailEnabled : boolean;

    // The OAuth providers the RUNNING instance registered at boot -- the sign-in page's provider buttons.
    providers : SocialProviderID[];
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
