//----------------------------------------------------------------------------------------------------------------------
// Download Model
//
// How a byte-serving response presents its file: rendered in place, or saved. This is the requester's choice at the
// moment of the request -- it is never stored on a grant, since anyone who can render bytes can save them.
//----------------------------------------------------------------------------------------------------------------------

export const contentDispositions = [ 'inline', 'attachment' ] as const;
export type ContentDisposition = typeof contentDispositions[number];

//----------------------------------------------------------------------------------------------------------------------
