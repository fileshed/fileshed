//----------------------------------------------------------------------------------------------------------------------
// Request/Response Wire Primitives
//
// DTOs are JSON: every Date field crossing the API boundary serializes as an ISO 8601 string, never a JS Date
// instance. isoDateTimeCodec is the one definition every request/response schema reuses, so the wire
// format for timestamps can't drift between endpoints.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

//----------------------------------------------------------------------------------------------------------------------

export const isoDateTimeCodec = z.iso.datetime();

//----------------------------------------------------------------------------------------------------------------------
