//----------------------------------------------------------------------------------------------------------------------
// Relative Date Formatting
//
// Short, glanceable node timestamps for the drive surface. Today's edits read as a clock time ("14:02 today", or
// "2:02 PM today" under the 12-hour preference); older dates in the current year drop to a month-and-day ("Jul 3");
// anything further back carries the year ("Jul 3, 2024"). The clock style is passed in, never read here, so the
// formatter stays pure -- the caller resolves the preference. `now` is injectable so the boundaries are testable
// without freezing the wall clock.
//----------------------------------------------------------------------------------------------------------------------

import type { TimeFormat } from '@fileshed/core';

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

// 24-hour renders the hour zero-padded ("14:02", "04:03"). 12-hour renders the hour 1-12 with no leading zero, minutes
// still padded, and an uppercase meridiem ("2:02 PM", "9:05 AM", "12:30 AM" at midnight, "12:00 PM" at noon).
function formatClock(date : Date, timeFormat : TimeFormat) : string
{
    const minutes = pad2(date.getMinutes());
    const hours = date.getHours();

    if(timeFormat === '24h')
    {
        return `${ pad2(hours) }:${ minutes }`;
    }

    const meridiem = hours < 12 ? 'AM' : 'PM';
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;

    return `${ hour12 }:${ minutes } ${ meridiem }`;
}

//----------------------------------------------------------------------------------------------------------------------

// A wire ISO string (or Date) rendered against `now`, with today's clock in the caller's chosen style. An unparseable
// input reads as empty rather than "Invalid Date", so a corrupt timestamp never leaks into the UI.
export function formatNodeDate(input : string | Date, timeFormat : TimeFormat, now : Date = new Date()) : string
{
    const date = input instanceof Date ? input : new Date(input);
    if(Number.isNaN(date.getTime())) { return ''; }

    if(sameDay(date, now))
    {
        return `${ formatClock(date, timeFormat) } today`;
    }

    const month = MONTHS[date.getMonth()] ?? '';
    if(date.getFullYear() === now.getFullYear())
    {
        return `${ month } ${ date.getDate() }`;
    }

    return `${ month } ${ date.getDate() }, ${ date.getFullYear() }`;
}

//----------------------------------------------------------------------------------------------------------------------
