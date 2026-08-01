//----------------------------------------------------------------------------------------------------------------------
// Ban Engine
//
// The banned flag is written once at ban time and only cleared lazily -- better-auth lifts it on the banned user's
// next sign-in attempt, and a user who never returns keeps the stale flag forever. Standing is therefore derived
// from the flag plus its expiry at read time, never read off the row alone.
//----------------------------------------------------------------------------------------------------------------------

export interface BanFacts
{
    banned : boolean;
    banReason : string | null;
    banExpires : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------

// A ban with no expiry holds until an explicit unban; a dated ban lapses the moment it expires. A lapsed ban reads
// as a clean record -- reason and expiry included, since surfacing them would present a ban that is no longer real.
export function effectiveBan(facts : BanFacts, now : Date) : BanFacts
{
    const inForce = facts.banned && (facts.banExpires === null || facts.banExpires.getTime() > now.getTime());

    if(inForce) { return facts; }

    return { banned: false, banReason: null, banExpires: null };
}

//----------------------------------------------------------------------------------------------------------------------
