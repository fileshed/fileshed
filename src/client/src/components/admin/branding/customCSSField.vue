<!----------------------------------------------------------------------------------------------------------------------
  -- Custom CSS Field
  --
  -- Not live-previewed: a half-typed selector must not break the page mid-keystroke, so the CSS applies through the
  -- stylesheet after Save. The ?safe-theme rescue is spelled out here because the admin who needs it will be looking at
  -- this field.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <BrandingField title="Custom CSS">
        <template #meta>
            <span class="ms-auto text-xs" :class="length > CUSTOM_CSS_MAX_LENGTH ? 'text-error' : 'text-muted'">
                {{ length.toLocaleString() }} / {{ CUSTOM_CSS_MAX_LENGTH.toLocaleString() }}
            </span>
        </template>

        <p class="mt-1 text-sm text-muted">
            Appended after the theme, for the things no knob covers. Applies on Save, not live. If it ever breaks
            the UI badly enough to lock you out, add
            <code class="rounded bg-elevated px-1 py-0.5 font-mono text-xs">?safe-theme</code>
            to the URL — the page loads with no branding at all, so you can come back here and fix it.
        </p>

        <CSSEditor
            :model-value="modelValue ?? ''"
            :theme="session.editorTheme"
            class="mt-3"
            @update:model-value="onInput"
        />
    </BrandingField>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { CUSTOM_CSS_MAX_LENGTH } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../../stores/session.ts';

    // Components
    import BrandingField from './brandingField.vue';
    import CSSEditor from './cssEditor.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ modelValue : string | null }>();

    const emit = defineEmits<{ 'update:modelValue' : [ value : string | null ] }>();

    const session = useSessionStore();

    const length = computed(() => props.modelValue?.length ?? 0);

    function onInput(value : string) : void
    {
        emit('update:modelValue', value === '' ? null : value);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
