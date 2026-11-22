//----------------------------------------------------------------------------------------------------------------------
// KaTeX Binding — drawing LaTeX
//
// The contract: renderLatex returns null until KaTeX has loaded, which the first call starts, and the drawn math after.
// LaTeX KaTeX can't read draws as an error in place rather than throwing, and with trust off a `\href` writes no link.
// Each test loads the binding fresh, so each starts with KaTeX not yet loaded.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

//----------------------------------------------------------------------------------------------------------------------

type RenderLatex = typeof import('@client/components/handlers/markdown/katex.ts').renderLatex;

async function loadedBinding() : Promise<RenderLatex>
{
    vi.resetModules();
    const { renderLatex } = await import('@client/components/handlers/markdown/katex.ts');
    await vi.waitFor(() => { expect(renderLatex('x', false)).not.toBeNull(); });

    return renderLatex;
}

//----------------------------------------------------------------------------------------------------------------------

describe('renderLatex', () =>
{
    it('returns null until KaTeX has loaded, then the drawn math', async () =>
    {
        vi.resetModules();
        const { renderLatex } = await import('@client/components/handlers/markdown/katex.ts');

        expect(renderLatex('x^2', false)).toBeNull();
        await vi.waitFor(() => { expect(renderLatex('x^2', false)).toContain('class="katex"'); });
    });

    it('draws display math in display mode', async () =>
    {
        const renderLatex = await loadedBinding();

        expect(renderLatex('x^2', true)).toContain('katex-display');
    });

    it('draws LaTeX it can\'t read as an error in place', async () =>
    {
        const renderLatex = await loadedBinding();

        expect(renderLatex('\\frac{1}{', false)).toContain('katex-error');
    });

    it('writes no link for `\\href`, since trust is off', async () =>
    {
        const renderLatex = await loadedBinding();

        const html = renderLatex('\\href{javascript:alert(1)}{click}', false);

        expect(html).not.toMatch(/<a[\s>]/u);
        expect(html).not.toContain('href="');
    });
});

//----------------------------------------------------------------------------------------------------------------------
