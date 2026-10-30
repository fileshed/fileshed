//----------------------------------------------------------------------------------------------------------------------
// Database Vocabulary
//
// This vocabulary lives in core because it is both an environment choice (the config schema parses it) and a wire
// value (the admin overview reports it).
//----------------------------------------------------------------------------------------------------------------------

export const databaseKinds = [ 'sqlite', 'postgres' ] as const;
export type DatabaseKind = typeof databaseKinds[number];

//----------------------------------------------------------------------------------------------------------------------
