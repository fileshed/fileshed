<!----------------------------------------------------------------------------------------------------------------------
  -- Custom CSS Field
  --
  -- The escape hatch. Deliberately NOT live-previewed: a half-typed selector must not wreck the admin
  -- mid-keystroke, so it applies through the stylesheet after Save -- and the rescue hatch gets spelled out
  -- right here, because the person who needs it will be staring at this field.
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
            the UI badly enough to lock you out, start the server with
            <code class="rounded bg-elevated px-1 py-0.5 font-mono text-xs">FILESHED_SAFE_THEME=1</code>
            and come back here.
        </p>

        <CssEditor
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
    import CssEditor from './cssEditor.vue';

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
