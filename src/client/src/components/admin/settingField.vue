<!----------------------------------------------------------------------------------------------------------------------
  -- Setting Field
  --
  -- One instance setting as an editable card, driven entirely by its vocabulary entry: a switch for boolean keys
  -- (saving on toggle), a number input with an explicit Save for numeric ones. The Overridden badge and the Reset
  -- control appear only when an override hides an actual default underneath -- a stored value with nothing
  -- beneath it is not overriding anything, and there is nothing to reset to. The card also flags the rare key
  -- whose change waits on a restart, and refuses to spend a round trip on a value its own bounds already reject.
  --
  -- A byte key reads and writes human sizes, and the echo underneath carries the exact count the pretty rendering
  -- rounds away.
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
                        v-if="entry.source === 'override' && entry.hasDefault"
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

            <div class="flex shrink-0 items-center gap-2">
                <UButton
                    v-if="entry.source === 'override' && entry.hasDefault"
                    label="Reset to default"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-undo-2"
                    :loading="pending"
                    @click="resetToDefault"
                />
                <USwitch
                    v-if="entry.kind === 'boolean'"
                    :model-value="entry.value === true"
                    :disabled="pending"
                    @update:model-value="saveBoolean"
                />
            </div>
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
                <p v-if="byteEcho !== null" class="mt-1 text-xs text-muted">
                    {{ byteEcho }}
                </p>
                <p v-if="violation" class="mt-1 text-xs text-error">
                    {{ violation }}
                </p>
            </div>
            <UButton
                label="Save"
                :loading="pending"
                :disabled="!dirty || draftNumber === null || violation !== null"
                @click="saveNumber"
            />
        </div>

        <div v-if="entry.kind === 'string'" class="mt-3 flex items-start gap-2">
            <div class="flex-1">
                <UInput
                    v-model="draft"
                    :placeholder="stringPlaceholder"
                    :autocomplete="entry.secret ? 'off' : undefined"
                    class="w-full"
                    @keydown.enter="saveString"
                />
                <p v-if="violation" class="mt-1 text-xs text-error">
                    {{ violation }}
                </p>
            </div>
            <UButton
                label="Save"
                :loading="pending"
                :disabled="!stringDirty || violation !== null"
                @click="saveString"
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

        // What zero means on a byte key that spends it as a sentinel ("Unlimited"), where echoing "0 bytes" would
        // contradict the setting.
        zeroLabel ?: string;
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
        if(secret.value || value === null) { return ''; }

        return props.unit === 'bytes' && typeof value === 'number' ? formatBytes(value) : String(value);
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

    // A byte draft still reading exactly as the stored value's rendering means that stored value, not the rounded
    // count the string parses back to: formatBytes throws precision away, and a field nobody touched must never
    // save a number nobody typed.
    function draftBytes() : number | null
    {
        const stored = props.entry.value;
        if(typeof stored === 'number' && draft.value === formatBytes(stored)) { return stored; }

        return parseByteSize(draft.value);
    }

    // The draft as a storable number, or null while it isn't one. Byte fields take human sizes ("20gb", "500mb")
    // or raw bytes; everything else (day counts) is a plain non-negative whole number.
    const draftNumber = computed<number | null>(() =>
    {
        if(props.unit === 'bytes') { return draftBytes(); }

        if(draft.value.trim() === '') { return null; }

        const value = Number(draft.value);
        return Number.isInteger(value) && value >= 0 ? value : null;
    });

    const dirty = computed(() => draftNumber.value !== null && draftNumber.value !== props.entry.value);

    const byteEcho = computed<string | null>(() =>
    {
        const value = draftNumber.value;
        if(props.unit !== 'bytes' || value === null) { return null; }

        if(value === 0 && props.zeroLabel !== undefined) { return props.zeroLabel; }

        return `= ${ describeByteSize(value) } (${ formatBytes(value) })`;
    });

    //------------------------------------------------------------------------------------------------------------------
    // Constraints
    //------------------------------------------------------------------------------------------------------------------

    function boundLabel(value : number) : string
    {
        return props.unit === 'bytes' ? formatBytes(value) : String(value);
    }

    // The bound the current draft misses, or null while it is storable. The server checks these independently -- all
    // this buys is a doomed round trip skipped and a message naming which bound was missed.
    const violation = computed<string | null>(() =>
    {
        const bounds = props.entry.constraints;
        if(bounds === undefined) { return null; }

        if(props.entry.kind === 'string')
        {
            const length = draft.value.trim().length;

            return bounds.maxLength !== undefined && length > bounds.maxLength
                ? `Must be ${ bounds.maxLength } characters or fewer.`
                : null;
        }

        const value = draftNumber.value;
        if(value === null) { return null; }

        if(bounds.min !== undefined && value < bounds.min) { return `Must be at least ${ boundLabel(bounds.min) }.`; }
        if(bounds.max !== undefined && value > bounds.max) { return `Must be at most ${ boundLabel(bounds.max) }.`; }

        return null;
    });

    //------------------------------------------------------------------------------------------------------------------

    function saveNumber() : void
    {
        const value = draftNumber.value;
        if(value === null || !dirty.value || violation.value !== null) { return; }

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
        if(!stringDirty.value || violation.value !== null) { return; }

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
