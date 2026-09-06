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

// The size caps a client must respect but cannot guess: an upload picker that hardcoded a ceiling would lie on
// every deployment that moved one. Read live, so a raised cap applies to the next page load.
export interface InstanceLimits
{
    uploadMaxBytes : number;
    avatarMaxBytes : number;

    // The filenames this instance refuses to store, as patterns. It rides here for the same reason the size cap does:
    // a client that knows the rule before it starts can skip a file rather than hash and send one that will be
    // refused, and a folder upload from a Mac otherwise carries one .DS_Store per directory.
    skippedUploadNames : string[];
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

    // Read live, unlike the boot-frozen facts above: name, mode, and cap changes apply on the next load, no restart.
    branding : InstanceBranding;
    limits : InstanceLimits;
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
