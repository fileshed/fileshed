//----------------------------------------------------------------------------------------------------------------------
// Format Regulation Code
//
// Turns a regulation rejection into a human line for a toast. The friendly copy is the shared RegulationCodeDisplay
// vocabulary from core; the server's raw message is only the fallback when a rejection carries no violation to render.
// The first violation with copy wins, so a rejection carrying several still reads as one clear sentence.
//----------------------------------------------------------------------------------------------------------------------

import { RegulationCodeDisplay } from '@fileshed/core';

// Resource Access
import type { RegulationApiError } from '../../resource-access/apiError.ts';

//----------------------------------------------------------------------------------------------------------------------

export function regulationMessage(error : RegulationApiError) : string
{
    for(const violation of error.violations)
    {
        const line = RegulationCodeDisplay[violation.code];
        if(line !== undefined) { return line; }
    }

    return error.message;
}

//----------------------------------------------------------------------------------------------------------------------
