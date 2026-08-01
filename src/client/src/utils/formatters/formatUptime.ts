//----------------------------------------------------------------------------------------------------------------------
// Uptime Formatting
//
// A process age at a glance: at most two units, largest first, and the smaller one dropped when it is zero. Nobody
// reading "how long has this thing been up" wants the seconds of a five-day run.
//----------------------------------------------------------------------------------------------------------------------

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

//----------------------------------------------------------------------------------------------------------------------

// Negative or non-finite input reads as a fresh start rather than "NaN".
export function formatUptime(seconds : number) : string
{
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;

    if(total < SECONDS_PER_MINUTE) { return `${ total }s`; }

    if(total < SECONDS_PER_HOUR)
    {
        return `${ Math.floor(total / SECONDS_PER_MINUTE) }m`;
    }

    if(total < SECONDS_PER_DAY)
    {
        const hours = Math.floor(total / SECONDS_PER_HOUR);
        const minutes = Math.floor(total % SECONDS_PER_HOUR / SECONDS_PER_MINUTE);

        return minutes === 0 ? `${ hours }h` : `${ hours }h ${ minutes }m`;
    }

    const days = Math.floor(total / SECONDS_PER_DAY);
    const hours = Math.floor(total % SECONDS_PER_DAY / SECONDS_PER_HOUR);

    return hours === 0 ? `${ days }d` : `${ days }d ${ hours }h`;
}

//----------------------------------------------------------------------------------------------------------------------
