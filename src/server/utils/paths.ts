//----------------------------------------------------------------------------------------------------------------------
// Data Paths
//
// Relative data paths resolve against the REPO ROOT, never process.cwd(): the Vite dev server runs the API with
// src/client as its cwd while the standalone entry runs at the root, and cwd-relative resolution silently split the
// two across separate data directories.
//----------------------------------------------------------------------------------------------------------------------

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

//----------------------------------------------------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function resolveDataPath(path : string) : string
{
    return isAbsolute(path) ? path : resolve(repoRoot, path);
}

//----------------------------------------------------------------------------------------------------------------------
