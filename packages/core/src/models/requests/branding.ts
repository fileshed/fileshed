//----------------------------------------------------------------------------------------------------------------------
// Branding API DTOs
//
// In a patch, an absent field is left alone and an explicit null unsets it back to stock. The response is always the
// complete merged document.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { InstanceTheme } from '../instanceTheme.ts';

//----------------------------------------------------------------------------------------------------------------------

export type UpdateBrandingRequest = Partial<InstanceTheme>;

//----------------------------------------------------------------------------------------------------------------------
