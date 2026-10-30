//----------------------------------------------------------------------------------------------------------------------
// Regulation Message
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
