//----------------------------------------------------------------------------------------------------------------------
// PDF Annotator Constants
//----------------------------------------------------------------------------------------------------------------------

// The largest PDF the in-app annotator will open. The floppy-sized text editor cap has no bearing here -- the annotator
// renders lazily, rasterizing only the visible pages plus a small buffer -- so this ceiling is not about render memory.
// It bounds the one place the whole file must be resident: saveDocument holds the entire PDF to serialize the
// incremental update, and the loaded bytes are held to re-render on a conflict reload. 100 MiB clears essentially every
// real document (scanned contracts, image-heavy decks) while refusing the pathological multi-gigabyte PDF that would
// wedge the tab. Over this, the file is offered as a native download, not annotation.
export const PDF_ANNOTATOR_MAX_BYTES = 100 * 1024 * 1024;

//----------------------------------------------------------------------------------------------------------------------
