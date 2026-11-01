//----------------------------------------------------------------------------------------------------------------------
// Frontmatter Store
//
// The open markdown file's frontmatter, read from the editor store's buffer and written back into it, so the buffer
// stays the one copy of the file and saves go through the editor store's save path.
//----------------------------------------------------------------------------------------------------------------------

import { computed } from 'vue';
import { defineStore } from 'pinia';

// Stores
import { useEditorStore } from './editor.ts';

// Engines
import { replaceFrontmatter, splitFrontmatter } from '../engines/markdown/frontmatter.ts';
import { buildDocumentMeta, parseFrontmatter, updateProperty } from '../engines/markdown/properties.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useFrontmatterStore = defineStore('frontmatter', () =>
{
    const editor = useEditorStore();

    // The YAML between the fences, or null when the file has no frontmatter. Body edits leave this string unchanged,
    // so the parse below reruns only when the frontmatter itself does.
    const yaml = computed(() => splitFrontmatter(editor.buffer).frontmatter?.yaml ?? null);

    const state = computed(() => parseFrontmatter(yaml.value));
    const meta = computed(() => buildDocumentMeta(state.value));

    // Blank YAML removes the block; YAML identical to what's there writes nothing.
    function apply(next : string) : void
    {
        if(editor.readOnly || next === (yaml.value ?? '')) { return; }

        editor.setBuffer(replaceFrontmatter(editor.buffer, next));
    }

    // Shaped for RenameTitle's rename prop. Only a file that already has property frontmatter has a title to edit.
    async function setTitle(title : string) : Promise<void>
    {
        if(yaml.value === null || state.value.kind !== 'properties') { return; }

        apply(updateProperty(yaml.value, 'title', title));
    }

    return {
        yaml,
        state,
        meta,
        apply,
        setTitle,
    };
});

//----------------------------------------------------------------------------------------------------------------------
