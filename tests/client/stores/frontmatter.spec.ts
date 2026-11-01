//----------------------------------------------------------------------------------------------------------------------
// Frontmatter Store — reading and writing the open file's frontmatter through the editor buffer
//
// The contract: the frontmatter is read from the editor store's buffer, and a write replaces only the frontmatter in
// that buffer. A viewer's session writes nothing, YAML identical to what the file holds writes nothing, and a title
// edit only applies to frontmatter that reads as properties.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Support
import { fileNode } from '../support.ts';

// Under test
import { useFrontmatterStore } from '@client/stores/frontmatter.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

function openFile(buffer : string, role : Role = 'owner') : void
{
    const node = fileNode({ name: 'notes.md', mimeType: 'text/markdown', role });

    useEditorStore().$patch({ node, buffer, autosaveEnabled: false });
}

//----------------------------------------------------------------------------------------------------------------------

describe('useFrontmatterStore', () =>
{
    beforeEach(() => { setActivePinia(createPinia()); });

    it('reads the title from the buffer\'s frontmatter', () =>
    {
        openFile('---\ntitle: Hello\n---\n\nBody');

        expect(useFrontmatterStore().meta.title).toBe('Hello');
    });

    it('replaces only the frontmatter in the buffer', () =>
    {
        openFile('---\ntitle: Hello\n---\n\n# Body\ntext');

        useFrontmatterStore().apply('title: Goodbye\n');

        expect(useEditorStore().buffer).toBe('---\ntitle: Goodbye\n---\n\n# Body\ntext');
    });

    it('writes nothing for a viewer', () =>
    {
        openFile('---\ntitle: Hello\n---\n\nBody', 'viewer');

        useFrontmatterStore().apply('title: Goodbye\n');

        expect(useEditorStore().buffer).toBe('---\ntitle: Hello\n---\n\nBody');
    });

    it('writes nothing when the YAML is what the file already holds', () =>
    {
        const file = '---\ntitle:   Hello\n---\nBody';
        openFile(file);
        const setBuffer = vi.spyOn(useEditorStore(), 'setBuffer');

        useFrontmatterStore().apply('title:   Hello\n');

        expect(setBuffer).not.toHaveBeenCalled();
        expect(useEditorStore().buffer).toBe(file);
    });

    it('sets the title property, keeping the rest of the frontmatter', async () =>
    {
        openFile('---\n# about\ntitle: Hello\ndraft: true\n---\n\nBody');

        await useFrontmatterStore().setTitle('Goodbye');

        expect(useEditorStore().buffer).toBe('---\n# about\ntitle: Goodbye\ndraft: true\n---\n\nBody');
    });

    it('leaves unreadable frontmatter alone when the title is set', async () =>
    {
        const file = '---\ntitle: [unclosed\n---\n\nBody';
        openFile(file);

        await useFrontmatterStore().setTitle('Goodbye');

        expect(useEditorStore().buffer).toBe(file);
    });
});

//----------------------------------------------------------------------------------------------------------------------
