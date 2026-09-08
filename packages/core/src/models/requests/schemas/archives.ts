//----------------------------------------------------------------------------------------------------------------------
// Archive API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { MAX_ARCHIVE_NODES } from '../../../constants/index.ts';

// Requests
import { type ArchiveQuery, archiveFormats } from '../archives.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// One comma-separated list rather than a repeated parameter: the query parser hands routes a flat record, so a
// repeated key would arrive as whichever value came last. Blank entries are dropped rather than becoming ids that
// match nothing, and an empty selection is refused -- an archive of nothing is a mistake, not a request.
export const archiveQueryCodec = z.strictObject({
    ids: z.string()
        .transform((raw) => raw.split(',')
            .map((id) => id.trim())
            .filter((id) => id !== ''))
        .pipe(z.array(z.string())
            .min(1)
            .max(MAX_ARCHIVE_NODES)),
    format: z.enum(archiveFormats),
});

typeAssert<Equals<z.output<typeof archiveQueryCodec>, ArchiveQuery>>();

//----------------------------------------------------------------------------------------------------------------------
