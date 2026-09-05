//----------------------------------------------------------------------------------------------------------------------
// Request/Response Wire Primitives
//
// DTOs are JSON: every Date field crossing the API boundary serializes as an ISO 8601 string, never a JS Date
// instance. isoDateTimeCodec is the one definition every request/response schema reuses, so the wire
// format for timestamps can't drift between endpoints.
//
// The name and mime-type codecs are here for the same reason: a node's name arrives through six endpoints and its mime
// type through four, and a bound applied at five of them is not a bound.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { MIME_TYPE_MAX_LENGTH, NODE_NAME_MAX_LENGTH, isValidMimeType } from '../../../constants/node.ts';

//----------------------------------------------------------------------------------------------------------------------

export const isoDateTimeCodec = z.iso.datetime();

export const nodeNameCodec = z.string()
    .min(1)
    .max(NODE_NAME_MAX_LENGTH);

// A stored mime type is written into a Content-Type header verbatim, so a value outside the media-type grammar leaves
// the node's own bytes un-servable. Rejected here rather than repaired: a request that supplied it can supply another.
export const mimeTypeCodec = z.string()
    .min(1)
    .max(MIME_TYPE_MAX_LENGTH)
    .refine(isValidMimeType, 'mimeType must be a media type of the form type/subtype');

//----------------------------------------------------------------------------------------------------------------------
