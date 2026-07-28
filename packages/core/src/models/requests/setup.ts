//----------------------------------------------------------------------------------------------------------------------
// Setup API DTOs
//
// The first-run wizard's contract. /api/instance is anonymous by design -- the pre-auth pages (sign-in, setup) need
// it before any session exists -- and carries only facts that are safe in anyone's hands. The setup request carries
// the one-time code the console printed (or the operator-provided automation token); the admin's password crosses
// the wire exactly once, here, and lands only as a hash.
//----------------------------------------------------------------------------------------------------------------------

export interface InstanceResponse
{
    needsSetup : boolean;
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
