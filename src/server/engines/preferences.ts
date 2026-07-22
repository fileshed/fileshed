//----------------------------------------------------------------------------------------------------------------------
// Preferences Engine
//
// The pure key-wise merge of a preferences patch into the stored blob. A key carrying a concrete value is set; a key
// carrying null is deleted (rootLabel null resets the files-root name to its default); an absent key is left as it was.
// Every key the stored blob already holds and the patch does not mention survives untouched -- that is the forward-
// compat guarantee, so a preference a newer client wrote is never dropped by an older client's write.
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
