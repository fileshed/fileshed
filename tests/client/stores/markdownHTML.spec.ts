//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML Store — whether the open markdown file's HTML renders
//
// The contract: the files the reader owns render their HTML, and a file someone else put in the reader's folder is not
// one of them. Anyone else's render it once the reader has turned on the preference, or has chosen to show it for that
// file; the choice covers only that file, and ends when it's hidden, which the editor does when the reader leaves it.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import { useMarkdownHTMLStore } from '@client/stores/markdownHTML.ts';

// Support
import { ME_ID, fileNode, meFixture } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const OTHER_ID = 'u2';

function openFile(ownerID : string, role : Role, id = 'f1') : void
{
    useEditorStore().$patch({ node: fileNode({ id, name: 'notes.md', ownerID, role }) });
}

//----------------------------------------------------------------------------------------------------------------------

describe('useMarkdownHTMLStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        useSessionStore().me = meFixture({ preferences: {} });
    });

    it('renders HTML in the reader\'s own file', () =>
    {
        openFile(ME_ID, 'owner');

        expect(useMarkdownHTMLStore().rendered).toBe(true);
    });

    it('does not render HTML in a file someone else owns', () =>
    {
        const html = useMarkdownHTMLStore();

        openFile(OTHER_ID, 'editor');
        expect(html.rendered).toBe(false);

        openFile(OTHER_ID, 'viewer');
        expect(html.rendered).toBe(false);
    });

    it('does not render HTML in a file someone else put in the reader\'s folder', () =>
    {
        openFile(OTHER_ID, 'owner');

        expect(useMarkdownHTMLStore().rendered).toBe(false);
    });

    it('renders HTML in someone else\'s file once the reader chooses to show it', () =>
    {
        const html = useMarkdownHTMLStore();
        openFile(OTHER_ID, 'viewer');

        html.show();

        expect(html.rendered).toBe(true);
    });

    it('keeps the choice to the file it was made on', () =>
    {
        const html = useMarkdownHTMLStore();
        openFile(OTHER_ID, 'viewer', 'f1');
        html.show();

        openFile(OTHER_ID, 'viewer', 'f2');

        expect(html.rendered).toBe(false);
    });

    it('stops rendering once the choice is hidden again', () =>
    {
        const html = useMarkdownHTMLStore();
        openFile(OTHER_ID, 'viewer');
        html.show();

        html.hide();

        expect(html.rendered).toBe(false);
    });

    it('renders HTML in someone else\'s file without asking when the preference is on', () =>
    {
        useSessionStore().me = meFixture({ preferences: { showMarkdownHTML: true } });

        openFile(OTHER_ID, 'viewer');

        expect(useMarkdownHTMLStore().rendered).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
