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
                    inputmode="numeric"
                    :placeholder="unit === 'bytes' ? 'e.g. 20gb, 500mb, or bytes' : undefined"
                    class="w-full"
                    @keydown.enter="saveNumber"
                />
                <p v-if="unit === 'bytes' && draftNumber !== null" class="mt-1 text-xs text-muted">
                    = {{ describeByteSize(draftNumber) }} ({{ formatBytes(draftNumber) }})
                </p>
            </div>
            <UButton
                label="Save"
                :loading="pending"
                :disabled="!dirty || draftNumber === null"
                @click="saveNumber"
            />
        </div>

        <div v-if="entry.kind === 'string'" class="mt-3 flex items-start gap-2">
            <UInput
                v-model="draft"
                :placeholder="stringPlaceholder"
                :autocomplete="entry.secret ? 'off' : undefined"
                class="flex-1"
                @keydown.enter="saveString"
            />
            <UButton
                label="Save"
                :loading="pending"
                :disabled="!stringDirty"
                @click="saveString"
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

    // Engines
    import { describeByteSize, parseByteSize } from '../../engines/byteSize.ts';

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

    // A secret's stored value never comes back (the server answers a masked tail), so its field is write-only: the
    // draft starts empty and the mask rides the placeholder instead.
    const secret = computed(() => props.entry.secret);

    function draftFor(value : typeof props.entry.value) : string
    {
        if(secret.value) { return ''; }

        return value === null ? '' : String(value);
    }

    // A text input on purpose even for numbers: UInput type=number emits numbers (its runtime coerces) while its
    // prop typing says string, and a spinner is useless on byte-sized values anyway. The draft stays a plain string.
    const draft = ref(props.entry.kind === 'boolean' ? '' : draftFor(props.entry.value));

    // Every save and reset replaces the entry with the server's refreshed view; the draft follows it so the field
    // always shows what is actually in effect -- and a secret's field empties again, staying write-only.
    watch(() => props.entry.value, (value) =>
    {
        if(props.entry.kind !== 'boolean') { draft.value = draftFor(value); }
    });

    // The draft as a storable number, or null while it isn't one. Byte fields take human sizes ("20gb", "500mb")
    // or raw bytes; everything else (day counts) is a plain non-negative whole number.
    const draftNumber = computed<number | null>(() =>
    {
        if(props.unit === 'bytes') { return parseByteSize(draft.value); }

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
    // String editing
    //------------------------------------------------------------------------------------------------------------------

    const stringPlaceholder = computed(() =>
    {
        if(secret.value) { return typeof props.entry.value === 'string' ? props.entry.value : 'Not set'; }

        return props.entry.value === null ? 'Not set' : undefined;
    });

    // For a secret any non-empty entry is a change (the stored value is unknowable here); otherwise the usual
    // differs-from-effective rule. Clearing a value is Reset to default, not an empty save.
    const stringDirty = computed(() =>
    {
        const trimmed = draft.value.trim();
        if(trimmed === '') { return false; }

        return secret.value || trimmed !== props.entry.value;
    });

    function saveString() : void
    {
        if(!stringDirty.value) { return; }

        void runMutation(() => settings.save(props.entry.key, draft.value.trim()), pending);
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
