//----------------------------------------------------------------------------------------------------------------------
// Admin Settings API DTOs
//
// The admin's view of the instance settings and the patch that changes them. Secret values never cross the wire
// outward -- a set secret reads as its masked tail -- and a patch value of null means "reset to the config default"
// (delete the override). The response carries per-key source and requiresRestart so the UI can say where a value
// came from and whether a change waits on a restart.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { AdminSettingKey, SettingConstraints, SettingKind, SettingValue } from '../instanceSettings.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface AdminSettingEntry
{
    key : AdminSettingKey;
    kind : SettingKind;
    secret : boolean;
    requiresRestart : boolean;

    // The effective value; a set secret arrives masked, an unset one as null.
    value : SettingValue | null;

    // Where the effective value came from: the loaded config (or vocabulary fallback), or an admin override.
    source : 'default' | 'override';

    // Whether deleting the override would leave a value behind (a config twin or vocabulary fallback). Existence
    // only -- the default itself never crosses the wire, so a config-supplied secret stays unreadable. The UI
    // offers Reset to default only when this is true: with nothing underneath, there is no default to reset to.
    hasDefault : boolean;

    // The key's bounds, so the field can hint them and refuse a doomed patch before spending a round trip. Absent
    // where the key has none. The server re-checks regardless -- these are for the human, not the gate.
    constraints ?: SettingConstraints;
}

export interface AdminSettingsResponse
{
    settings : AdminSettingEntry[];

    // True when a requiresRestart key changed after the server started.
    restartRequired : boolean;
}

export interface PatchSettingsRequest
{
    // Key -> new value, or null to reset the override away.
    changes : Partial<Record<AdminSettingKey, SettingValue | null>>;
}

//----------------------------------------------------------------------------------------------------------------------
