//----------------------------------------------------------------------------------------------------------------------
// Relative Date Formatting
//
// Short, glanceable node timestamps for the drive surface. Today's edits read as a clock time ("14:02 today"); older
// dates in the current year drop to a month-and-day ("Jul 3"); anything further back carries the year ("Jul 3, 2024").
// `now` is injectable so the boundaries are testable without freezing the wall clock.
//----------------------------------------------------------------------------------------------------------------------

const MONTHS = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ] as const;

//----------------------------------------------------------------------------------------------------------------------

function pad2(value : number) : string
{
    return value < 10 ? `0${ value }` : String(value);
}

function sameDay(first : Date, second : Date) : boolean
{
    return first.getFullYear() === second.getFullYear()
        && first.getMonth() === second.getMonth()
        && first.getDate() === second.getDate();
}

//----------------------------------------------------------------------------------------------------------------------

// A wire ISO string (or Date) rendered against `now`. An unparseable input reads as empty rather than "Invalid Date",
// so a corrupt timestamp never leaks into the UI.
export function formatNodeDate(input : string | Date, now : Date = new Date()) : string
{
    const date = input instanceof Date ? input : new Date(input);
    if(Number.isNaN(date.getTime())) { return ''; }

    if(sameDay(date, now))
    {
        return `${ pad2(date.getHours()) }:${ pad2(date.getMinutes()) } today`;
    }

    const month = MONTHS[date.getMonth()] ?? '';
    if(date.getFullYear() === now.getFullYear())
    {
        return `${ month } ${ date.getDate() }`;
    }

    return `${ month } ${ date.getDate() }, ${ date.getFullYear() }`;
}

//----------------------------------------------------------------------------------------------------------------------
