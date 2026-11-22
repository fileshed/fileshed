//----------------------------------------------------------------------------------------------------------------------
// Mermaid Binding — drawing a diagram
//
// The contract: renderMermaid resolves with the diagram's SVG, drawn at Mermaid's strict security level with its own
// error diagram off and in the theme asked for, and rejects with Mermaid's message for code it can't read. Diagrams
// draw one at a time. Mermaid itself is replaced, since it needs a browser's layout to draw.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Under test
import { renderMermaid } from '@client/components/handlers/markdown/mermaid.ts';

//----------------------------------------------------------------------------------------------------------------------

const mermaid = vi.hoisted(() => ({
    initialize: vi.fn(),
    render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaid }));

//----------------------------------------------------------------------------------------------------------------------

describe('renderMermaid', () =>
{
    beforeEach(() =>
    {
        mermaid.initialize.mockReset();
        mermaid.render.mockReset();
    });

    it('draws at the strict security level with Mermaid\'s error diagram off, in the theme asked for', async () =>
    {
        mermaid.render.mockResolvedValue({ svg: '<svg>diagram</svg>' });

        const svg = await renderMermaid('graph TD\n  A --> B', true);

        expect(svg).toBe('<svg>diagram</svg>');
        expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: 'dark',
        }));
    });

    it('rejects with Mermaid\'s message for code it can\'t read', async () =>
    {
        mermaid.render.mockRejectedValue(new Error('Parse error on line 1'));

        await expect(renderMermaid('not a diagram', false)).rejects.toThrow('Parse error on line 1');
    });

    it('starts a diagram only once the one before it has finished', async () =>
    {
        let finishFirst : (value : { svg : string }) => void = () => undefined;
        mermaid.render
            .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
            .mockResolvedValueOnce({ svg: '<svg>second</svg>' });

        const first = renderMermaid('graph TD\n  A', false);
        const second = renderMermaid('graph TD\n  B', false);
        await vi.waitFor(() => { expect(mermaid.render).toHaveBeenCalledTimes(1); });

        finishFirst({ svg: '<svg>first</svg>' });

        expect(await first).toBe('<svg>first</svg>');
        expect(await second).toBe('<svg>second</svg>');
        expect(mermaid.render).toHaveBeenCalledTimes(2);
    });
});

//----------------------------------------------------------------------------------------------------------------------
