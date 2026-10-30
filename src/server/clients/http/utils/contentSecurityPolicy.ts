//----------------------------------------------------------------------------------------------------------------------
// Content Security Policy
//
// The policy for the documents FileShed serves itself. It is the layer the in-app viewers do not otherwise have: the
// `sandbox` policy in userContentHeaders.ts applies to a response loaded as a document, and does nothing for bytes the
// app fetches into its own page -- which is what the PDF, markdown, text and media handlers all do.
//
// script-src carries neither 'unsafe-inline' nor 'unsafe-eval'. The client is a build-step Vue app: every script it
// runs is a hashed same-origin module, and the runtime template compiler (the one part of Vue that needs eval) is not
// in the bundle. 'wasm-unsafe-eval' is the single concession, and it is not optional -- hash-wasm compiles its SHA-256
// module from bytes at runtime, so without it every upload fails before a byte moves.
//----------------------------------------------------------------------------------------------------------------------

type Directives = Record<string, string[]>;

//----------------------------------------------------------------------------------------------------------------------

const APP_DIRECTIVES : Directives = {
    'default-src': [ "'self'" ],

    'script-src': [ "'self'", "'wasm-unsafe-eval'" ],

    // Style is where the app genuinely cannot be strict: the colour-mode toggle injects a <style> element, tiptap and
    // CodeMirror inject theirs, and every floating element Nuxt UI positions carries a style attribute -- which no
    // nonce can authorize. Inline CSS buys an attacker far less than inline script, and script is where the line holds.
    'style-src': [ "'self'", "'unsafe-inline'" ],

    // data: for the SVG icons the stylesheets carry inline; blob: for embedded cover art and the avatar cropper.
    'img-src': [ "'self'", 'data:', 'blob:' ],

    // pdf.js embeds a document's own fonts as data: URLs when it cannot hand them to the FontFace constructor.
    'font-src': [ "'self'", 'data:' ],

    // Playlists carry absolute http(s) entries alongside node references, and those become the player's source. Both
    // schemes, because an instance served over plain http has http entries to play; on an https instance the browser
    // refuses those as mixed content long before this policy is consulted.
    'media-src': [ "'self'", 'https:', 'http:' ],

    // Everything the client talks to is this origin. This is also what makes the icon pipeline's promise true: a
    // bundled-icon miss falls back to a fetch against api.iconify.design, and a self-hosted instance never makes it.
    // blob: reaches nowhere -- a blob URL is readable only by the page that minted it -- and the avatar cropper reads
    // the chosen image back through one.
    'connect-src': [ "'self'", 'blob:' ],

    // The pdf.js worker is a hashed asset of this origin.
    'worker-src': [ "'self'" ],

    // Nothing in this app embeds anything, is embedded by anything, or posts a form anywhere but here.
    'frame-src': [ "'none'" ],
    'object-src': [ "'none'" ],
    'base-uri': [ "'self'" ],
    'form-action': [ "'self'" ],
    'frame-ancestors': [ "'none'" ],
};

function serialize(directives : Directives) : string
{
    return Object.entries(directives)
        .map(([ name, sources ]) => `${ name } ${ sources.join(' ') }`)
        .join('; ');
}

//----------------------------------------------------------------------------------------------------------------------

export const APP_CONTENT_SECURITY_POLICY = serialize(APP_DIRECTIVES);

// The reference UI is a different application under the same roof: one bundle of ours, plus the inline call that
// starts it, which is what the nonce authorizes. What it still reaches for on its own account -- a search against
// Scalar's registry -- this refuses, which is the point of hosting the thing ourselves.
export function docsContentSecurityPolicy(nonce : string) : string
{
    return serialize({ ...APP_DIRECTIVES, 'script-src': [ "'self'", `'nonce-${ nonce }'` ] });
}

//----------------------------------------------------------------------------------------------------------------------
