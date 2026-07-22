//----------------------------------------------------------------------------------------------------------------------
// User Preferences Domain Model
//
// A user's preferences ride in a single JSON blob so adding one never needs a migration. This type is the KNOWN view a
// client of this version understands. Unknown keys are not modelled here on purpose: their survival across writes is a
// storage property enforced by the key-wise merge on the server, not a shape the app reasons about. rootLabel is the
// name shown for the files root; timeFormat is the clock style for node timestamps; editorTheme is the id of the
// editor colorscheme and editorGutter whether its line-number gutter shows. Any key absent means the default, which is
// resolved on the client -- the blob stores only what the user has chosen.
//----------------------------------------------------------------------------------------------------------------------

export const timeFormats = [ '12h', '24h' ] as const;
export type TimeFormat = typeof timeFormats[number];

export interface UserPreferences
{
    rootLabel ?: string;
    timeFormat ?: TimeFormat;
    editorTheme ?: string;
    editorGutter ?: boolean;
}

//----------------------------------------------------------------------------------------------------------------------
