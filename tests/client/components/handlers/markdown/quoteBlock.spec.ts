//----------------------------------------------------------------------------------------------------------------------
// Markdown Quote Block — quotes and callouts in Preview
//
// The contract: a plain quote draws as a quote. A callout draws in its kind's color with its kind's icon: GitHub's five
// in GitHub's colors, Obsidian's other kinds and their aliases in Obsidian's. A callout marked `-` starts folded, with
// only its title line showing, and opens on its toggle; one marked `+` starts open; one with neither has no toggle.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw } from 'vue';

// Under test
import MarkdownQuoteBlock from '@client/components/handlers/markdown/quoteBlock.vue';

// Support
import { closeEditors, openMarkdown } from '../../../engines/markdown/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    NodeViewWrapper: { template: '<div><slot /></div>' },
    NodeViewContent: { template: '<div data-node-view-content />' },
    UIcon: { props: [ 'name' ], template: '<i class="icon" :data-name="name" />' },
    UButton: { template: '<button class="toggle" />' },
};

let wrapper : VueWrapper | null = null;

function mountQuote(markdown : string) : VueWrapper
{
    const live = openMarkdown(markdown, []);

    wrapper = mount(MarkdownQuoteBlock, {
        props: { editor: markRaw(live), node: live.state.doc.child(0), getPos: () => 0 } as never,
        global: { stubs },
    });

    return wrapper;
}

function drawnAs(quote : VueWrapper) : { color : string | undefined; icon : string | undefined }
{
    const icon = quote.find('.icon');

    return { color: quote.attributes('data-color'), icon: icon.exists() ? icon.attributes('data-name') : undefined };
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownQuoteBlock', () =>
{
    afterEach(() =>
    {
        wrapper?.unmount();
        wrapper = null;
        closeEditors();
    });

    it('draws a plain quote with no callout color or icon', () =>
    {
        const quote = mountQuote('> Just a quote');

        expect(quote.classes()).not.toContain('md-callout');
        expect(drawnAs(quote)).toEqual({ color: undefined, icon: undefined });
    });

    it('draws GitHub\'s five kinds in GitHub\'s colors with their icons', () =>
    {
        const kinds = [ 'NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION' ].map((type) =>
        {
            const drawn = drawnAs(mountQuote(`> [!${ type }]\n> Body`));
            wrapper?.unmount();

            return drawn;
        });

        expect(kinds).toEqual([
            { color: 'blue', icon: 'i-lucide-info' },
            { color: 'green', icon: 'i-lucide-lightbulb' },
            { color: 'purple', icon: 'i-lucide-message-square-warning' },
            { color: 'yellow', icon: 'i-lucide-triangle-alert' },
            { color: 'red', icon: 'i-lucide-octagon-alert' },
        ]);
    });

    it('draws an Obsidian alias as the kind it stands for, and an unknown type as a note', () =>
    {
        const alias = drawnAs(mountQuote('> [!faq] Why?\n> Because'));
        expect(alias).toEqual({ color: 'yellow', icon: 'i-lucide-circle-help' });
        wrapper?.unmount();

        expect(drawnAs(mountQuote('> [!recipe]\n> Body'))).toEqual({ color: 'blue', icon: 'i-lucide-info' });
    });

    it('starts a `-` callout folded and opens it on its toggle', async () =>
    {
        const quote = mountQuote('> [!note]- Details\n> Hidden');
        expect(quote.classes()).toContain('md-callout-folded');

        await quote.find('.toggle').trigger('click');

        expect(quote.classes()).not.toContain('md-callout-folded');
    });

    it('starts a `+` callout open, and gives a callout with no fold marker no toggle', () =>
    {
        const open = mountQuote('> [!note]+ Details\n> Shown');
        expect(open.classes()).not.toContain('md-callout-folded');
        expect(open.find('.toggle').exists()).toBe(true);
        open.unmount();

        const plain = mountQuote('> [!note] Details\n> Shown');
        expect(plain.find('.toggle').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
