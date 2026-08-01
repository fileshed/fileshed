//----------------------------------------------------------------------------------------------------------------------
// User Constants
//----------------------------------------------------------------------------------------------------------------------

export const DISPLAY_NAME_MAX_LENGTH = 100;

// The shortest conceivable address is a@b; the longest is what RFC 5321 permits on the wire.
export const EMAIL_MIN_LENGTH = 3;
export const EMAIL_MAX_LENGTH = 254;

// better-auth's own sign-up minimum. Anything shorter here would be accepted by us and refused by it.
export const PASSWORD_MIN_LENGTH = 8;

// A ban expiry is whole days; past a year it is the no-expiry kind, lifted by hand.
export const BAN_MAX_EXPIRES_DAYS = 365;

// Capped to keep the reason a note, not an essay.
export const BAN_REASON_MAX_LENGTH = 500;

//----------------------------------------------------------------------------------------------------------------------
