<!----------------------------------------------------------------------------------------------------------------------
  -- Setting Field
  --
  -- One instance setting as an editable card, driven entirely by its vocabulary entry: a switch for boolean keys
  -- (saving on toggle), a number input with an explicit Save for numeric ones. The card tells the admin where the
  -- value came from -- an Overridden badge and a Reset control appear only when a database override is in play --
  -- and flags the rare key whose change waits on a restart.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4" :data-setting="entry.key">
        <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-medium text-default">
                        {{ label }}
                    </h3>
                    <UBadge
                        v-if="entry.source === 'override'"
                        label="Overridden"
                        color="primary"
                        variant="subtle"
                        size="sm"
                    />
                    <UBadge
                        v-if="entry.requiresRestart"
                        label="Needs restart"
                        color="warning"
                        variant="subtle"
                        size="sm"
                    />
                </div>
                <p class="mt-1 text-sm text-muted">
                    {{ description }}
                </p>
            </div>

            <USwitch
                v-if="entry.kind === 'boolean'"
                :model-value="entry.value === true"
                :disabled="pending"
                @update:model-value="saveBoolean"
            />
        </div>

        <div v-if="entry.kind === 'number'" class="mt-3 flex items-start gap-2">
            <div class="flex-1">
                <UInput
                    v-model="draft"
                    type="number"
                    min="0"
                    class="w-full"
                    @keydown.enter="saveNumber"
                />
                <p v-if="unit === 'bytes' && draftNumber !== null" class="mt-1 text-xs text-muted">
                    = {{ formatBytes(draftNumber) }}
                </p>
            </div>
            <UButton
                label="Save"
                :loading="pending"
                :disabled="!dirty || draftNumber === null"
                @click="saveNumber"
            />
        </div>

        <div v-if="entry.source === 'override'" class="mt-3">
            <UButton
                label="Reset to default"
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-undo-2"
                :loading="pending"
                @click="resetToDefault"
            />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';

    import type { AdminSettingEntry } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';
    import { formatBytes } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        entry : AdminSettingEntry;
        label : string;
        description : string;
        unit ?: 'bytes' | 'days';
    }>();

    const settings = useAdminSettingsStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    //------------------------------------------------------------------------------------------------------------------
    // Number editing
    //------------------------------------------------------------------------------------------------------------------

    const draft = ref(props.entry.kind === 'number' ? String(props.entry.value ?? '') : '');

    // Every save and reset replaces the entry with the server's refreshed view; the draft follows it so the field
    // always shows what is actually in effect.
    watch(() => props.entry.value, (value) =>
    {
        if(props.entry.kind === 'number') { draft.value = String(value ?? ''); }
    });

    // The draft as a storable number, or null while it isn't one (empty, negative, fractional).
    const draftNumber = computed<number | null>(() =>
    {
        if(draft.value.trim() === '') { return null; }

        const value = Number(draft.value);
        return Number.isInteger(value) && value >= 0 ? value : null;
    });

    const dirty = computed(() => draftNumber.value !== null && draftNumber.value !== props.entry.value);

    function saveNumber() : void
    {
        const value = draftNumber.value;
        if(value === null || !dirty.value) { return; }

        void runMutation(() => settings.save(props.entry.key, value), pending);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Boolean + reset
    //------------------------------------------------------------------------------------------------------------------

    function saveBoolean(value : boolean) : void
    {
        void runMutation(() => settings.save(props.entry.key, value), pending);
    }

    function resetToDefault() : void
    {
        void runMutation(() => settings.reset(props.entry.key), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
