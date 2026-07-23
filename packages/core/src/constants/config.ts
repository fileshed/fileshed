//----------------------------------------------------------------------------------------------------------------------
// Config Defaults
//
// The fallback values behind the env-driven config schema. The schema (src/server/utils/config.ts) owns which values
// are tunable and how they validate; these are only what applies when the environment says nothing.
//----------------------------------------------------------------------------------------------------------------------

export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_PORT = 3000;
export const DEFAULT_DATABASE_PATH = './data/fileshed.db';
export const DEFAULT_BASE_URL = 'http://localhost:5173';
export const DEFAULT_STORAGE_ROOT = './data/blobs';
export const DEFAULT_GC_GRACE_DAYS = 7;
export const DEFAULT_GC_INTERVAL_MINUTES = 60;
export const DEFAULT_TRASH_PURGE_DAYS = 30;
export const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const DEFAULT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

//----------------------------------------------------------------------------------------------------------------------
