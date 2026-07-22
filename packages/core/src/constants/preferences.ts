//----------------------------------------------------------------------------------------------------------------------
// Preferences Constants
//----------------------------------------------------------------------------------------------------------------------

import type { TimeFormat } from '../models/userPreferences.ts';

//----------------------------------------------------------------------------------------------------------------------

export const ROOT_LABEL_MAX_LENGTH = 64;

// The files-root name shown when a user has set none.
export const DEFAULT_ROOT_LABEL = 'My Files';

// The clock style for node timestamps when a user has set none.
export const DEFAULT_TIME_FORMAT : TimeFormat = '12h';

export const EDITOR_THEME_MAX_LENGTH = 64;

// The editor colorscheme id when a user has set none. Must name an entry in the client theme registry; a stored id the
// registry does not know resolves back to this one.
export const DEFAULT_EDITOR_THEME = 'ayu-dark';

// Whether the editor shows its line-number gutter when a user has set none.
export const DEFAULT_EDITOR_GUTTER = false;

//----------------------------------------------------------------------------------------------------------------------
