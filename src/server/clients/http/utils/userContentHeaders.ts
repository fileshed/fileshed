//----------------------------------------------------------------------------------------------------------------------
// User Content Headers
//
// What every response carrying bytes somebody uploaded is served with. Handing those bytes back is the whole product,
// so the point is not to refuse anything -- it is that FileShed answers from the same origin as the signed-in app, and
// a document rendered on that origin can spend the viewer's session. `sandbox` drops the response into an opaque
// origin with no scripting, which costs an image, an audio file or a video nothing, and costs an uploaded page every
// door it could have walked through. `allow-downloads` is the one token given back, so a viewer can still save what
// they opened.
//
// Deployments that would rather not rely on this can serve content from an origin of its own, where the session cookie
// never reaches; that is a hostname decision rather than a code one, and this is what protects the single-origin
// default everybody else runs.
//----------------------------------------------------------------------------------------------------------------------

export const USER_CONTENT_HEADERS : Record<string, string> = {
    'content-security-policy': 'sandbox allow-downloads',
    'x-content-type-options': 'nosniff',
};

//----------------------------------------------------------------------------------------------------------------------
