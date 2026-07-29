//----------------------------------------------------------------------------------------------------------------------
// Drive Listing Filters
//
// The pure vocabulary and math behind the drive's owner and modified-date filters: the modified-date presets and their
// translation into the half-open [after, before) instants the server wants, and the chip summaries that report an
// active selection. No Vue, no store, no I/O -- so the date math and the summaries are unit-testable in isolation, and
// the filter bar and store share one source of truth. Type-family presentation lives in
// utils/formatters/nodeTypePresentation.ts.
//----------------------------------------------------------------------------------------------------------------------

import { MS_PER_DAY, type UserSummary } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------
// Owner
//----------------------------------------------------------------------------------------------------------------------

// The owner filter is only worth offering when a folder has more than one owner -- a folder that is all yours needs no
// way to filter by owner.
export function ownerChipVisible(owners : readonly UserSummary[]) : boolean
{
    return owners.length > 1;
}

export function ownerFilterSummary(owner : UserSummary | null) : string | null
{
    if(owner === null) { return null; }

    const [ firstName ] = owner.name.trim().split(/\s+/);
    return firstName !== undefined && firstName.length > 0 ? firstName : owner.email;
}

//----------------------------------------------------------------------------------------------------------------------
// Modified date
//----------------------------------------------------------------------------------------------------------------------

export const modifiedPresets = [ 'today', 'last7', 'last30', 'thisYear', 'lastYear' ] as const;
export type ModifiedPreset = typeof modifiedPresets[number];

export const MODIFIED_PRESET_LABELS : Record<ModifiedPreset, string> = {
    today: 'Today',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    thisYear: 'This year',
    lastYear: 'Last year',
};

// A modified filter is either one of the presets or an explicit custom range whose bounds are already the half-open
// ISO instants the server wants (after inclusive, before exclusive).
export type ModifiedFilter
    = | { kind : 'preset'; preset : ModifiedPreset }
    | { kind : 'range'; after : string; before : string };

// A half-open window: updated_at >= after (inclusive) and < before (exclusive). A preset with no upper bound omits
// `before` -- nothing is updated in the future, so "today or later" is just "today".
export interface ModifiedWindow
{
    after ?: string;
    before ?: string;
}

function startOfDay(date : Date) : Date
{
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfYear(date : Date, yearOffset = 0) : Date
{
    return new Date(date.getFullYear() + yearOffset, 0, 1);
}

// Translate a modified filter into its date window, resolved against `now` (injectable for tests). Relative presets
// count back exact days; calendar presets pin to local midnight boundaries; a range passes its bounds through.
export function modifiedRange(filter : ModifiedFilter, now : Date = new Date()) : ModifiedWindow
{
    if(filter.kind === 'range') { return { after: filter.after, before: filter.before }; }

    switch (filter.preset)
    {
        case 'today':
            return { after: startOfDay(now).toISOString() };
        case 'last7':
            return { after: new Date(now.getTime() - (7 * MS_PER_DAY)).toISOString() };
        case 'last30':
            return { after: new Date(now.getTime() - (30 * MS_PER_DAY)).toISOString() };
        case 'thisYear':
            return { after: startOfYear(now).toISOString() };
        case 'lastYear':
            return { after: startOfYear(now, -1).toISOString(), before: startOfYear(now).toISOString() };
    }
}

export function modifiedFilterSummary(filter : ModifiedFilter | null) : string | null
{
    if(filter === null) { return null; }
    return filter.kind === 'preset' ? MODIFIED_PRESET_LABELS[filter.preset] : 'Custom';
}

//----------------------------------------------------------------------------------------------------------------------
