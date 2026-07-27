//----------------------------------------------------------------------------------------------------------------------
// Media Playback Engine
//
// Pure logic behind the video and audio transport controls: time formatting, seek clamping, the buffered-ahead
// percentage for the scrub bar, and the fixed playback-rate ladder the rate menu offers. Callers hand in plain
// numbers (and a TimeRanges-shaped buffered list) read off the native media element's own events -- nothing here
// touches the DOM.
//----------------------------------------------------------------------------------------------------------------------

export interface BufferedRanges
{
    length : number;
    start(index : number) : number;
    end(index : number) : number;
}

export const PLAYBACK_RATES = [ 0.5, 0.75, 1, 1.25, 1.5, 2 ] as const;

//----------------------------------------------------------------------------------------------------------------------

// mm:ss under an hour, h:mm:ss at or past it. Nothing to show yet (no duration, or a NaN mid-load) reads as the
// placeholder rather than "NaN:NaN".
export function formatMediaTime(seconds : number) : string
{
    if(!Number.isFinite(seconds) || seconds < 0) { return '--:--'; }

    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    const paddedSecs = String(secs).padStart(2, '0');

    if(hours > 0) { return `${ hours }:${ String(minutes).padStart(2, '0') }:${ paddedSecs }`; }

    return `${ minutes }:${ paddedSecs }`;
}

// A seek target held inside the playable range. An unknown duration (still loading) only floors the request at
// zero -- there is nothing to clamp the upper end against yet.
export function clampSeekTime(time : number, duration : number) : number
{
    const floored = Math.max(0, time);

    return Number.isFinite(duration) && duration > 0 ? Math.min(floored, duration) : floored;
}

// How far the browser has buffered ahead, as a percentage of the total duration -- the widest buffered range's end,
// since a progressive download buffers contiguously from the start rather than in scattered chunks. Zero when
// nothing has buffered yet or the duration isn't known.
export function bufferedPercent(buffered : BufferedRanges, duration : number) : number
{
    if(!Number.isFinite(duration) || duration <= 0) { return 0; }

    let furthest = 0;
    for(let index = 0; index < buffered.length; index += 1) { furthest = Math.max(furthest, buffered.end(index)); }

    return Math.min(100, Math.max(0, (furthest / duration) * 100));
}

//----------------------------------------------------------------------------------------------------------------------
