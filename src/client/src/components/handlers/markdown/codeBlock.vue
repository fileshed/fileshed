<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Code Block
  --
  -- The header is outside the editable content, so ProseMirror never reads the picker as part of the code.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper class="md-code-block overflow-hidden rounded-md border border-muted bg-muted">
        <div contenteditable="false" class="flex justify-end border-b border-muted px-2 py-1">
            <USelectMenu
                v-if="!store.readOnly"
                :model-value="selectedOption"
                by="value"
                :items="options"
                :search-input="{ placeholder: 'Search languages' }"
                virtualize
                size="xs"
                variant="ghost"
                color="neutral"
                :ui="{ content: 'w-56' }"
                aria-label="Code language"
                @update:model-value="pick"
            />
            <span v-else class="px-2 py-0.5 text-xs text-muted">{{ selectedOption.label }}</span>
        </div>

        <pre><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style scoped>
    /* The editor's prose styling frames every pre; here the frame is the wrapper, which also holds the header. */
    .md-code-block pre {
        margin: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
    }

    .md-code-block :deep(:is(.tok-keyword, .tok-operator)) {
        color: var(--code-keyword);
    }

    .md-code-block :deep(:is(.tok-string, .tok-string2, .tok-url)) {
        color: var(--code-string);
    }

    .md-code-block :deep(.tok-comment) {
        color: var(--code-comment);
    }

    .md-code-block :deep(:is(.tok-number, .tok-bool, .tok-atom, .tok-literal, .tok-propertyName, .tok-meta)) {
        color: var(--code-constant);
    }

    .md-code-block :deep(:is(.tok-definition, .tok-className, .tok-macroName, .tok-labelName)) {
        color: var(--code-entity);
    }

    .md-code-block :deep(:is(.tok-typeName, .tok-namespace, .tok-variableName2)) {
        color: var(--code-type);
    }

    .md-code-block :deep(.tok-inserted) {
        color: var(--code-inserted);
    }

    .md-code-block :deep(:is(.tok-deleted, .tok-invalid)) {
        color: var(--code-deleted);
    }

    .md-code-block :deep(.tok-heading) {
        color: var(--code-constant);
        font-weight: 600;
    }

    .md-code-block :deep(.tok-strong) {
        font-weight: 600;
    }

    .md-code-block :deep(.tok-emphasis) {
        font-style: italic;
    }

    .md-code-block :deep(.tok-link) {
        text-decoration: underline;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Engines
    import {
        type CodeLanguageOption,
        codeLanguageOptions,
        fenceLanguageWord,
        withFenceLanguage,
    } from '../../../engines/markdown/codeLanguages.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownCodeBlock' });

    const props = defineProps(nodeViewProps);

    const PLAIN_TEXT : CodeLanguageOption = { label: 'Plain text', value: '' };

    const store = useEditorStore();

    const info = computed(() => props.node.attrs.language as string | null);
    const selected = computed(() => fenceLanguageWord(info.value));

    // A fence naming a language the picker doesn't list keeps that name as an option of its own, so the picker shows
    // what the file says rather than a blank.
    const options = computed<CodeLanguageOption[]>(() =>
    {
        const listed = selected.value === '' || codeLanguageOptions.some((option) => option.value === selected.value);
        return [
            PLAIN_TEXT,
            ...(listed ? [] : [ { label: selected.value, value: selected.value } ]),
            ...codeLanguageOptions,
        ];
    });

    // The menu holds whole options, compared by value: its items can't carry plain text's empty value on their own.
    const selectedOption = computed(() =>
        options.value.find((option) => option.value === selected.value) ?? PLAIN_TEXT);

    function pick(option : CodeLanguageOption) : void
    {
        if(option.value === selected.value) { return; }

        props.updateAttributes({ language: withFenceLanguage(info.value, option.value) });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
