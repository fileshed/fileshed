//----------------------------------------------------------------------------------------------------------------------
// Request/Response Wire Primitives
//
// Every request/response schema reuses these codecs, so the wire format for timestamps (ISO 8601 strings, never a JS
// Date) and the bounds on a node's name and mime type cannot drift between endpoints. A node's name arrives through
// several endpoints, and a bound applied at all but one of them is not a bound.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { MIME_TYPE_MAX_LENGTH, NODE_NAME_MAX_LENGTH } from '../../../constants/node.ts';

// Utils
import { isValidMimeType } from '../../../utils/mimeType.ts';

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
