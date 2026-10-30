//----------------------------------------------------------------------------------------------------------------------
// Preferences Engine
//
// Every stored key the patch does not mention survives untouched, so a preference a newer client wrote is never dropped
// by an older client's write.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { UpdatePreferencesRequest } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function applyPreferencesPatch(
    stored : Record<string, unknown>,
    patch : UpdatePreferencesRequest
) : Record<string, unknown>
{
    const merged : Record<string, unknown> = { ...stored };

    for(const [ key, value ] of Object.entries(patch))
    {
        if(value === null) { Reflect.deleteProperty(merged, key); }
        else if(value !== undefined) { merged[key] = value; }
    }

    return merged;
}

//----------------------------------------------------------------------------------------------------------------------
