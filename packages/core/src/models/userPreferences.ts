//----------------------------------------------------------------------------------------------------------------------
// User Preferences Domain Model
//
// A user's preferences ride in a single JSON blob so adding one never needs a migration. This type is the known view a
// client of this version understands. Unknown keys survive writes through the server's key-wise merge, so they are not
// modelled here. An absent key means the default, which the client resolves: the blob stores only what the user has
// chosen.
//
// colorMode is overridden by an instance-forced mode and itself overrides the instance default. allowRemoteMedia is
// whether a playlist entry pointing off this instance may be played.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ColorMode } from './instanceTheme.ts';

//----------------------------------------------------------------------------------------------------------------------

export const timeFormats = [ '12h', '24h' ] as const;
export type TimeFormat = typeof timeFormats[number];

export const viewModes = [ 'grid', 'list' ] as const;
export type ViewMode = typeof viewModes[number];

export interface UserPreferences
{
    rootLabel ?: string;
    timeFormat ?: TimeFormat;
    editorTheme ?: string;
    editorGutter ?: boolean;
    viewMode ?: ViewMode;
    colorMode ?: ColorMode;
    allowRemoteMedia ?: boolean;
}

//----------------------------------------------------------------------------------------------------------------------
