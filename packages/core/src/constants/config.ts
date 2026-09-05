//----------------------------------------------------------------------------------------------------------------------
// Config Defaults
//
// The fallback values behind the env-driven config schema. The schema (src/server/utils/config.ts) owns which values
// are tunable and how they validate; these are only what applies when the environment says nothing.
//----------------------------------------------------------------------------------------------------------------------

export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_PORT = 3950;
export const DEFAULT_DATABASE_PATH = './data/fileshed.db';
export const DEFAULT_BASE_URL = 'http://localhost:5173';
export const DEFAULT_STORAGE_ROOT = './data/blobs';
export const DEFAULT_GC_GRACE_DAYS = 7;
export const DEFAULT_GC_INTERVAL_MINUTES = 60;
export const DEFAULT_TRASH_PURGE_DAYS = 30;
export const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const DEFAULT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_SMTP_PORT = 587;

// The wildcard entry ALLOWED_HOSTS and TRUSTED_ORIGINS both accept: any host may mint this instance's URLs, any origin
// may write to it. It is the development posture -- a box reached at localhost, at its LAN address, and at a .local
// name in one sitting -- stated rather than inferred from an ambient variable.
export const ANY_HOST = '*';

//----------------------------------------------------------------------------------------------------------------------
// Chunk sizing
//
// Uploads travel as a sequence of PUTs against one ticket, so the ceiling a deployment can accept is the chunk size,
// not the file size -- a fronting proxy's request-body cap stops mattering once no single request carries the whole
// file. 8 MiB clears the caps that bite in practice by a wide margin (Cloudflare's 100 MB on free and pro, tunnels
// included; API Gateway's 10 MB) while keeping the round trips per gigabyte in the low hundreds, which is noise next
// to the bytes themselves. It also bounds what a failed chunk costs: a retry re-sends at most this much.
//----------------------------------------------------------------------------------------------------------------------

export const DEFAULT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

// The smallest chunk size worth configuring. nginx ships client_max_body_size at 1m, the tightest request-body cap in
// common use, so a 1 MiB chunk already clears every proxy anyone actually fronts this with -- going lower appeases
// nothing and only multiplies round trips, each carrying its own authentication and ticket bookkeeping. A value under
// it is a misconfiguration, not a tradeoff.
export const MIN_UPLOAD_CHUNK_BYTES = 1024 * 1024;

// Byte count of a generated AUTH_SECRET, written base64. Matches what `openssl rand -base64 32` produces, which is
// what the docs tell an operator minting one by hand.
export const GENERATED_AUTH_SECRET_BYTES = 32;

// Name of the secret file FileShed manages for itself, alongside the database in the data directory.
export const AUTH_SECRET_FILE_NAME = 'auth-secret';

// Owner read/write only. The file is the whole key to every sealed setting, so group and world get nothing.
export const AUTH_SECRET_FILE_MODE = 0o600;

//----------------------------------------------------------------------------------------------------------------------
