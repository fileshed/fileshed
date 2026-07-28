//----------------------------------------------------------------------------------------------------------------------
// Admin Settings API DTOs
//
// The admin's view of the instance settings and the patch that changes them. Secret values never cross the wire
// outward -- a set secret reads as its masked tail -- and a patch value of null means "reset to the config default"
// (delete the override). The response carries per-key source and tier so the UI can say where a value came from and
// how a change takes effect.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { AdminSettingKey, SettingKind, SettingTier, SettingValue } from '../instanceSettings.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface AdminSettingEntry
{
    key : AdminSettingKey;
    tier : SettingTier;
    kind : SettingKind;
    secret : boolean;

    // The effective value; a set secret arrives masked, an unset one as null.
    value : SettingValue | null;

    // Where the effective value came from: the loaded config (or vocabulary fallback), or an admin override.
    source : 'default' | 'override';
}

export interface AdminSettingsResponse
{
    settings : AdminSettingEntry[];

    // True when a restart-tier key changed after the server started.
    restartRequired : boolean;
}

export interface PatchSettingsRequest
{
    // Key -> new value, or null to reset the override away.
    changes : Partial<Record<AdminSettingKey, SettingValue | null>>;
}

//----------------------------------------------------------------------------------------------------------------------
