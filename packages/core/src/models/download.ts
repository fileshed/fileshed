//----------------------------------------------------------------------------------------------------------------------
// Download Model
//
// The requester chooses this per request. It is never stored on a grant, since anyone who can render bytes can save
// them.
//----------------------------------------------------------------------------------------------------------------------

export const contentDispositions = [ 'inline', 'attachment' ] as const;
export type ContentDisposition = typeof contentDispositions[number];

//----------------------------------------------------------------------------------------------------------------------
