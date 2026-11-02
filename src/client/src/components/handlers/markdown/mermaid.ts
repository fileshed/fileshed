//----------------------------------------------------------------------------------------------------------------------
// Mermaid Binding
//
// Mermaid loads when the first diagram is drawn, and draws at its strict security level: labels are sanitized text and
// diagrams get no click handlers. One diagram draws at a time, since Mermaid's settings are global.
//----------------------------------------------------------------------------------------------------------------------

import type { Mermaid } from 'mermaid';

//----------------------------------------------------------------------------------------------------------------------

let mermaid : Promise<Mermaid> | null = null;
let queue : Promise<unknown> = Promise.resolve();
let drawn = 0;

async function draw(source : string, dark : boolean) : Promise<string>
{
    mermaid ??= import('mermaid').then((module) => module.default);
    const engine = await mermaid.catch((error : unknown) =>
    {
        mermaid = null;
        throw error;
    });

    // Mermaid would otherwise draw its own error diagram into the page for code it can't read.
    engine.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: dark ? 'dark' : 'default',
    });
    drawn += 1;
    const { svg } = await engine.render(`md-mermaid-${ drawn }`, source);

    return svg;
}

// The diagram's SVG. Rejects with Mermaid's own message when it can't read the source.
export function renderMermaid(source : string, dark : boolean) : Promise<string>
{
    const next = queue.then(() => draw(source, dark));
    queue = next.catch(() => undefined);

    return next;
}

//----------------------------------------------------------------------------------------------------------------------
