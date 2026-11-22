//----------------------------------------------------------------------------------------------------------------------
// Word Count
//
// Words are the locale's own word segments, so a language written without spaces between words still counts each
// word. Punctuation and whitespace don't count.
//----------------------------------------------------------------------------------------------------------------------

// A language tag the browser rejects falls back to its default locale.
function wordSegmenter(locale ?: string) : Intl.Segmenter
{
    try
    {
        return new Intl.Segmenter(locale, { granularity: 'word' });
    }
    catch
    {
        return new Intl.Segmenter(undefined, { granularity: 'word' });
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function countWords(text : string, locale ?: string) : number
{
    let count = 0;
    for(const segment of wordSegmenter(locale).segment(text))
    {
        if(segment.isWordLike) { count += 1; }
    }

    return count;
}

//----------------------------------------------------------------------------------------------------------------------
