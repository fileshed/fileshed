//----------------------------------------------------------------------------------------------------------------------
// Media Playback Engine — time formatting, seek clamping, buffered percentage, playback-rate ladder
//
// All pure functions, real data, no mocks. Buffered ranges are hand-built plain objects shaped like the native
// TimeRanges the video/audio elements hand the players -- length plus indexed start/end accessors.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    type BufferedRanges,
    PLAYBACK_RATES,
    bufferedPercent,
    clampSeekTime,
    formatMediaTime,
    nextPlaybackRate,
} from '@client/engines/media/playback.ts';

//----------------------------------------------------------------------------------------------------------------------

function ranges(pairs : [ number, number ][]) : BufferedRanges
{
    return {
        length: pairs.length,
        start: (index : number) => pairs[index]?.[0] ?? 0,
        end: (index : number) => pairs[index]?.[1] ?? 0,
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('formatMediaTime', () =>
{
    it('formats sub-minute seconds as 0:ss', () =>
    {
        expect(formatMediaTime(0)).toBe('0:00');
        expect(formatMediaTime(5)).toBe('0:05');
    });

    it('formats minutes and seconds as m:ss', () =>
    {
        expect(formatMediaTime(65)).toBe('1:05');
        expect(formatMediaTime(3599)).toBe('59:59');
    });

    it('formats an hour or more as h:mm:ss', () =>
    {
        expect(formatMediaTime(3600)).toBe('1:00:00');
        expect(formatMediaTime(3661)).toBe('1:01:01');
    });

    it('truncates a fractional second rather than rounding up', () =>
    {
        expect(formatMediaTime(59.9)).toBe('0:59');
    });

    it('shows a placeholder rather than a negative or non-finite time', () =>
    {
        expect(formatMediaTime(-1)).toBe('--:--');
        expect(formatMediaTime(Number.NaN)).toBe('--:--');
        expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe('--:--');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('clampSeekTime', () =>
{
    it('floors a negative seek target at zero', () =>
    {
        expect(clampSeekTime(-10, 100)).toBe(0);
    });

    it('holds a seek target inside the known duration', () =>
    {
        expect(clampSeekTime(50, 100)).toBe(50);
        expect(clampSeekTime(150, 100)).toBe(100);
    });

    it('only floors the request when the duration is not known yet', () =>
    {
        expect(clampSeekTime(50, Number.NaN)).toBe(50);
        expect(clampSeekTime(-5, Number.NaN)).toBe(0);
        expect(clampSeekTime(50, 0)).toBe(50);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('bufferedPercent', () =>
{
    it('reads zero from an empty buffered list', () =>
    {
        expect(bufferedPercent(ranges([]), 60)).toBe(0);
    });

    it('is the single buffered range\'s end over the duration', () =>
    {
        expect(bufferedPercent(ranges([ [ 0, 30 ] ]), 60)).toBe(50);
    });

    it('takes the furthest range\'s end when several have buffered', () =>
    {
        expect(bufferedPercent(ranges([ [ 0, 10 ], [ 20, 45 ] ]), 90)).toBeCloseTo(50);
    });

    it('clamps to 100 rather than reporting over-buffered', () =>
    {
        expect(bufferedPercent(ranges([ [ 0, 120 ] ]), 100)).toBe(100);
    });

    it('reads zero when the duration is not known yet', () =>
    {
        expect(bufferedPercent(ranges([ [ 0, 30 ] ]), Number.NaN)).toBe(0);
        expect(bufferedPercent(ranges([ [ 0, 30 ] ]), 0)).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('nextPlaybackRate', () =>
{
    it('steps to the next rate in the ladder', () =>
    {
        expect(nextPlaybackRate(1)).toBe(1.25);
        expect(nextPlaybackRate(0.5)).toBe(0.75);
    });

    it('wraps from the fastest rate back to the slowest', () =>
    {
        expect(nextPlaybackRate(PLAYBACK_RATES[PLAYBACK_RATES.length - 1])).toBe(PLAYBACK_RATES[0]);
    });

    it('resolves a rate outside the ladder to its first step', () =>
    {
        expect(nextPlaybackRate(3)).toBe(PLAYBACK_RATES[0]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
