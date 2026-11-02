//----------------------------------------------------------------------------------------------------------------------
// KaTeX Binding
//
// KaTeX and its stylesheet load when the first math is drawn. Until they arrive renderLatex returns null, and since it
// reads a ref, a computed or render that called it runs again once they do.
//----------------------------------------------------------------------------------------------------------------------

import { shallowRef } from 'vue';
import type KaTeX from 'katex';

//----------------------------------------------------------------------------------------------------------------------

const katex = shallowRef<typeof KaTeX | null>(null);
let loading : Promise<void> | null = null;

function loadKaTeX() : void
{
    loading ??= Promise.all([ import('katex'), import('katex/dist/katex.min.css') ])
        .then(([ module ]) => { katex.value = module.default; })
        // A failed load leaves math as source, and the next math drawn asks again.
        .catch(() => { loading = null; });
}

// HTML for some LaTeX, or null while KaTeX loads. LaTeX KaTeX can't read draws as an error in place, and with trust
// off KaTeX writes no links, styles or classes the LaTeX asks for.
export function renderLatex(latex : string, displayMode : boolean) : string | null
{
    const engine = katex.value;
    if(!engine)
    {
        loadKaTeX();
        return null;
    }

    return engine.renderToString(latex, { displayMode, throwOnError: false, trust: false });
}

//----------------------------------------------------------------------------------------------------------------------
