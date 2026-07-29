//----------------------------------------------------------------------------------------------------------------------
// Color Mode Control
//
// The applier over the same @vueuse/core state Nuxt UI's own plugin drives (useDark is useColorMode with the
// dark class and an empty light value): identical options here mean identical storage semantics, so the choice
// persists under the plugin's key and the right mode applies on the NEXT load before any fetch -- no flash.
//----------------------------------------------------------------------------------------------------------------------

import { useColorMode } from '@vueuse/core';

// Models
import type { ColorMode } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

let mode : ReturnType<typeof useColorMode> | null = null;

function control() : ReturnType<typeof useColorMode>
{
    mode ??= useColorMode({ emitAuto: true, modes: { dark: 'dark', light: '' } });

    return mode;
}

export function applyColorMode(value : ColorMode) : void
{
    control().value = value === 'system' ? 'auto' : value;
}

//----------------------------------------------------------------------------------------------------------------------
