//----------------------------------------------------------------------------------------------------------------------
// Editor Area Routes
//
// The file surface is its own top-level layout, split out of the drive shell so the editor gets the whole screen.
// What this guards: /file/:id resolves to the named file route, that route nests under the editor layout -- not the
// drive shell -- and its :id segment is required. A guardless memory router built from the real route table exercises
// the nesting without dragging the auth guard or a session in.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { type Router, createMemoryHistory, createRouter } from 'vue-router';

// Importing the router drags the whole app graph in. The layouts reference a public SVG the test transform can't
// resolve, and every page pulls @nuxt/ui's composables transitively -- stub those seams. Route resolution never
// renders a component, so trivial stand-ins are enough to exercise the real route table.
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('@client/layouts/mainLayout.vue', () => ({
    default: { name: 'MainLayout', template: '<div><router-view /></div>' },
}));
vi.mock('@client/layouts/accountLayout.vue', () => ({
    default: { name: 'AccountLayout', template: '<div><router-view /></div>' },
}));
vi.mock('@client/layouts/editorLayout.vue', () => ({
    default: { name: 'EditorLayout', template: '<div><router-view /></div>' },
}));

import { routes } from '@client/router/index.ts';

//----------------------------------------------------------------------------------------------------------------------

function testRouter() : Router
{
    return createRouter({ history: createMemoryHistory(), routes });
}

//----------------------------------------------------------------------------------------------------------------------

describe('editor area routes', () =>
{
    it('resolves /file/:id to the named file route', async () =>
    {
        const router = testRouter();

        await router.push('/file/abc123');

        expect(router.currentRoute.value.name).toBe('file');
        expect(router.currentRoute.value.path).toBe('/file/abc123');
        expect(router.currentRoute.value.params.id).toBe('abc123');
    });

    it('nests the file route under the editor layout, out of the drive shell', async () =>
    {
        const router = testRouter();

        await router.push('/file/abc123');

        const paths = router.currentRoute.value.matched.map((record) => record.path);
        expect(paths).toContain('/file/:id');
        expect(paths).not.toContain('/');

        const layout = router.currentRoute.value.matched[0]?.components?.default as { name ?: string } | undefined;
        expect(layout?.name).toBe('EditorLayout');
    });

    it('requires an id segment -- bare /file matches nothing', async () =>
    {
        const router = testRouter();

        await router.push('/file');

        expect(router.currentRoute.value.matched).toHaveLength(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
