//----------------------------------------------------------------------------------------------------------------------
// Regulation Message
//----------------------------------------------------------------------------------------------------------------------

import { RegulationCodeDisplay } from '@fileshed/core';

// Resource Access
import type { RegulationAPIError } from '../../resource-access/apiError.ts';

//----------------------------------------------------------------------------------------------------------------------

export function regulationMessage(error : RegulationAPIError) : string
{
    for(const violation of error.violations)
    {
        const line = RegulationCodeDisplay[violation.code];
        if(line !== undefined) { return line; }
    }

    return error.message;
}

//----------------------------------------------------------------------------------------------------------------------
