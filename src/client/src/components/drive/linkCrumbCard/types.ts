//----------------------------------------------------------------------------------------------------------------------
// Link Crumb Types
//----------------------------------------------------------------------------------------------------------------------

import type { BreadcrumbItem } from '@nuxt/ui';

import type { NodeResponse, UserSummary } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The link node behind a link breadcrumb plus its resolved target owner -- everything the marker and hover card draw
// from. owner is null when the target owner is unknown (a dead link, or a summary the facet never disclosed).
export interface LinkCrumbData
{
    node : NodeResponse;
    owner : UserSummary | null;
}

// A plain crumb: the root or an ordinary folder, a navigable label and nothing more.
interface PlainCrumb extends BreadcrumbItem
{
    link ?: undefined;
}

// A folder-link crumb, rendered through the breadcrumb's `link` slot. The literal slot discriminant is what lets
// UBreadcrumb type that slot's item as this variant (a bare `string` slot collapses the slot item to `never`).
interface LinkCrumb extends BreadcrumbItem
{
    slot : 'link';
    link : LinkCrumbData;
}

export type DriveCrumb = PlainCrumb | LinkCrumb;

//----------------------------------------------------------------------------------------------------------------------
