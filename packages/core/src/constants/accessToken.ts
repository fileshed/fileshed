//----------------------------------------------------------------------------------------------------------------------
// Access Token Constants
//
// Two api-key configurations back the two credential kinds: durable PATs the user mints and manages, and short-lived
// playback keys the media player mints for itself (cast receivers fetch media URLs cookie-less, so the credential
// rides the URL). The prefixes make a leaked string identifiable at a glance; the playback TTL is sized to a long
// listening session, and the refresh window is how close to expiry the player re-mints on a track change.
//----------------------------------------------------------------------------------------------------------------------

import { MS_PER_HOUR, MS_PER_MINUTE } from './time.ts';

//----------------------------------------------------------------------------------------------------------------------

export const ACCESS_TOKEN_CONFIG_PAT = 'pat';
export const ACCESS_TOKEN_CONFIG_PLAYBACK = 'playback';

export const ACCESS_TOKEN_PREFIX = 'fspat_';
export const PLAYBACK_TOKEN_PREFIX = 'fsplay_';

export const PLAYBACK_TOKEN_TTL_MS = 5 * MS_PER_HOUR;
export const PLAYBACK_TOKEN_REFRESH_WINDOW_MS = 30 * MS_PER_MINUTE;

//----------------------------------------------------------------------------------------------------------------------
