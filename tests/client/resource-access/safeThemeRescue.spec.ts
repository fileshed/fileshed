//----------------------------------------------------------------------------------------------------------------------
// Safe Theme Rescue — the pre-mount escape from hostile branding CSS
//
// Presence of the key is the whole trigger, so the parameter has to be read as a parameter: a key that merely
// starts with it, or the words sitting in some other key's value, must not blank an instance's branding.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';

// Under test
import { applySafeThemeRescue } from '@client/resource-access/safeThemeRescue.ts';

//----------------------------------------------------------------------------------------------------------------------

function brandingLink() : Element | null
{
    return document.querySelector('link[href*="branding.css"]');
}

beforeEach(() =>
{
    document.head.innerHTML = '<link rel="icon" href="/fileshed.svg" />'
        + '<link rel="stylesheet" href="/api/branding.css" />';
});

//----------------------------------------------------------------------------------------------------------------------

describe('applySafeThemeRescue', () =>
{
    it('removes the branding stylesheet when the query carries the parameter', () =>
    {
        applySafeThemeRescue('?safe-theme', document);

        expect(brandingLink()).toBeNull();
    });

    it('takes the parameter with any value, since presence is the signal', () =>
    {
        applySafeThemeRescue('?safe-theme=0&page=2', document);

        expect(brandingLink()).toBeNull();
    });

    it('finds the stylesheet after a save has cache-busted its href', () =>
    {
        document.head.innerHTML = '<link rel="stylesheet" href="/api/branding.css?v=1753900000000" />';

        applySafeThemeRescue('?safe-theme', document);

        expect(brandingLink()).toBeNull();
    });

    it('leaves every other link in the head alone', () =>
    {
        applySafeThemeRescue('?safe-theme', document);

        expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
    });

    it('leaves the stylesheet in place with no query at all', () =>
    {
        applySafeThemeRescue('', document);

        expect(brandingLink()).not.toBeNull();
    });

    it('leaves the stylesheet in place for an unrelated query', () =>
    {
        applySafeThemeRescue('?view=list&sort=name', document);

        expect(brandingLink()).not.toBeNull();
    });

    it('does not fire for a longer key that merely starts with the parameter', () =>
    {
        applySafeThemeRescue('?safe-themeX', document);

        expect(brandingLink()).not.toBeNull();
    });

    it('does not fire when the words are some other key\'s value', () =>
    {
        applySafeThemeRescue('?foo=safe-theme', document);

        expect(brandingLink()).not.toBeNull();
    });

    it('is a no-op on a document with no branding stylesheet', () =>
    {
        document.head.innerHTML = '';

        expect(() => applySafeThemeRescue('?safe-theme', document)).not.toThrow();
    });
});

//----------------------------------------------------------------------------------------------------------------------
