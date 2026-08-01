//----------------------------------------------------------------------------------------------------------------------
// Handler Limits
//
// The size ceilings the in-app file handlers open up to. Over its ceiling a file falls back to the native path --
// browser preview or download -- rather than opening in a handler that would wedge the tab.
//----------------------------------------------------------------------------------------------------------------------

// One 3.5-inch HD floppy, to the byte. If a text file won't fit on a floppy, you have no business hand-editing it in a
// browser -- open it in something that streams.
export const EDITOR_MAX_BYTES = 1_474_560;

// The floppy-sized text editor cap has no bearing here -- the annotator renders lazily, rasterizing only the visible
// pages plus a small buffer -- so this ceiling is not about render memory. It bounds the one place the whole file must
// be resident: saveDocument holds the entire PDF to serialize the incremental update, and the loaded bytes are held to
// re-render on a conflict reload. 100 MiB clears essentially every real document (scanned contracts, image-heavy decks)
// while refusing the pathological multi-gigabyte PDF.
export const PDF_ANNOTATOR_MAX_BYTES = 100 * 1024 * 1024;

//----------------------------------------------------------------------------------------------------------------------
