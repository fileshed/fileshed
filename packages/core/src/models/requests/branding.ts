//----------------------------------------------------------------------------------------------------------------------
// Branding API DTOs
//
// The admin's theme surface: GET answers the full document, PATCH takes any subset of it -- an absent field is
// "leave alone", an explicit null is "unset back to stock". The response is always the complete merged document.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { InstanceTheme } from '../instanceTheme.ts';

//----------------------------------------------------------------------------------------------------------------------

export type UpdateBrandingRequest = Partial<InstanceTheme>;

//----------------------------------------------------------------------------------------------------------------------
