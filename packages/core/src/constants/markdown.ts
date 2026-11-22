//----------------------------------------------------------------------------------------------------------------------
// Markdown Editing
//----------------------------------------------------------------------------------------------------------------------

// How much of their wording two lines must share (twice the shared words over both lines' words) to count as one line
// spelled two ways. `See [docs][ref] for more.` and `See [docs](https://example.com) for more.` share two thirds.
export const MARKDOWN_LINE_LIKENESS = 0.5;

// The most line pairs a merge compares by wording. A larger stretch, which only a file with no line unique in it can
// produce, is paired on identical lines alone.
export const MARKDOWN_MAX_LINE_PAIRS = 250_000;

//----------------------------------------------------------------------------------------------------------------------
