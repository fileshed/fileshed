//----------------------------------------------------------------------------------------------------------------------
// Database Vocabulary
//
// The dialects a deployment can run on. Lives in core because it is both an environment choice (the config schema
// parses it) and a wire value (the admin overview reports it) -- one vocabulary, so the two can never disagree.
//----------------------------------------------------------------------------------------------------------------------

export const databaseKinds = [ 'sqlite', 'postgres' ] as const;
export type DatabaseKind = typeof databaseKinds[number];

//----------------------------------------------------------------------------------------------------------------------
