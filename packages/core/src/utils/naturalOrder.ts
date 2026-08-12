//----------------------------------------------------------------------------------------------------------------------
// Natural Name Ordering
//
// The one statement of how FileShed orders names, and the only one any tier may sort by. Postgres is held to it by an
// ICU collation built from the same locale; SQLite by sorting through this comparator in Node, because JS exposes an
// ICU comparator but no ICU sort key, so there is nothing to hand SQLite that would order the same way; the client by
// calling it directly. A change here that does not move the collation with it splits the three apart.
//----------------------------------------------------------------------------------------------------------------------

// Constants
import { NATURAL_ORDER_LOCALE, NATURAL_ORDER_OPTIONS } from '../constants/naturalOrder.ts';

//----------------------------------------------------------------------------------------------------------------------

// One collator for the process -- building one per comparison is what makes a naive name sort crawl.
const collator = new Intl.Collator(NATURAL_ORDER_LOCALE, NATURAL_ORDER_OPTIONS);

//----------------------------------------------------------------------------------------------------------------------

// Ties are real: two names differing only in case, accent, or the leading zeros of a digit run compare equal, and the
// caller supplies its own tiebreak. Every tier tiebreaks on id.
export function compareNames(left : string, right : string) : number
{
    return collator.compare(left, right);
}

//----------------------------------------------------------------------------------------------------------------------
