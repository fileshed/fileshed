//----------------------------------------------------------------------------------------------------------------------
// Media Playback Engine — time formatting, seek clamping, buffered percentage, playback-rate ladder
//
// All pure functions, real data, no mocks. Buffered ranges are hand-built plain objects shaped like the native
// TimeRanges the video/audio elements hand the players -- length plus indexed start/end accessors.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    type BufferedRanges,
    bufferedPercent,
    clampSeekTime,
    formatMediaTime,
    sameMediaSource,
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

describe('sameMediaSource', () =>
{
    const TRACK = '/api/nodes/n1/download?disposition=inline';

    // The case it exists for: a cast session starting adds the playback key to the src of the track already
    // playing, and the element reloads onto a URL that addresses the very same bytes.
    it('reads a src that gained a playback token as the same media', () =>
    {
        expect(sameMediaSource(`${ TRACK }&token=fsplay_k1`, TRACK)).toBe(true);
    });

    it('reads a token being replaced as the same media', () =>
    {
        expect(sameMediaSource(`${ TRACK }&token=fsplay_k2`, `${ TRACK }&token=fsplay_k1`)).toBe(true);
    });

    it('reads a different node as different media, however the tokens compare', () =>
    {
        const other = '/api/nodes/n2/download?disposition=inline';

        expect(sameMediaSource(other, TRACK)).toBe(false);
        expect(sameMediaSource(`${ other }&token=fsplay_k1`, `${ TRACK }&token=fsplay_k1`)).toBe(false);
    });

    // A playlist entry can point anywhere, and two remote streams are only the same one if the whole URL is.
    it('compares absolute sources whole', () =>
    {
        expect(sameMediaSource('https://stream.example/a.mp3', 'https://stream.example/a.mp3')).toBe(true);
        expect(sameMediaSource('https://stream.example/a.mp3', 'https://stream.example/b.mp3')).toBe(false);
    });

    it('does not confuse a different disposition for the same request', () =>
    {
        expect(sameMediaSource('/api/nodes/n1/download', TRACK)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
