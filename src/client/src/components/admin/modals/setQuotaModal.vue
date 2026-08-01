<!----------------------------------------------------------------------------------------------------------------------
  -- Set Quota Modal
  --
  -- Opened imperatively for one account. A quota has three states and the control shows all three, because two of them
  -- look identical on an instance that defaults to unlimited and diverge the moment an admin tightens the default:
  -- inheriting the instance default moves the account with it, while an explicit Unlimited pins the account above it.
  -- The third is a cap this account alone carries.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="`Quota for ${ targetName }`" :dismissible="!pending">
        <template #body>
            <div class="flex flex-col gap-4">
                <URadioGroup v-model="mode" :items="modeItems" :disabled="pending" />

                <UFormField v-if="mode === 'custom'" label="Size cap" help="A size like 20gb or 500mb, or raw bytes.">
                    <UInput
                        v-model="draft"
                        inputmode="numeric"
                        placeholder="e.g. 20gb"
                        class="w-full"
                        @keydown.enter="onSave"
                    />
                    <p v-if="draftBytes !== null" class="mt-1 text-xs text-muted">
                        = {{ describeByteSize(draftBytes) }} ({{ formatBytes(draftBytes) }})
                    </p>
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="open = false" />
                    <UButton label="Save" :loading="pending" :disabled="!valid" @click="onSave" />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import type { RadioGroupItem } from '@nuxt/ui';

    import { type AdminUserResponse, UNLIMITED_QUOTA } from '@fileshed/core';

    // Resource Access
    import { setQuota } from '../../../resource-access/admin.ts';

    // Engines
    import { describeByteSize, parseByteSize } from '../../../engines/byteSize.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';
    import { formatBytes } from '../../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    type QuotaMode = 'default' | 'unlimited' | 'custom';

    const props = defineProps<{ defaultQuota : number }>();

    const emit = defineEmits<{ saved : [ user : AdminUserResponse ] }>();

    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<AdminUserResponse | null>(null);
    const mode = ref<QuotaMode>('default');

    // A text input on purpose: UInput type=number emits numbers while its prop typing says string. Plain string
    // draft; validation decides what counts as a cap.
    const draft = ref('');

    const targetName = computed(() => target.value?.name ?? target.value?.email ?? '');

    const modeItems = computed<RadioGroupItem[]>(() =>
    {
        const inherited = props.defaultQuota === UNLIMITED_QUOTA ? 'unlimited' : formatBytes(props.defaultQuota);

        return [
            {
                value: 'default',
                label: 'Use the instance default',
                description: `Currently ${ inherited }. This account follows the default whenever it changes.`,
            },
            {
                value: 'unlimited',
                label: 'Unlimited',
                description: 'No cap on this account, even if the instance default is tightened later.',
            },
            {
                value: 'custom',
                label: 'Custom cap',
                description: 'A size this account alone carries.',
            },
        ];
    });

    // The draft as a storable cap: null while it isn't a parseable size -- human units ("20gb", "500mb") or raw bytes.
    // A field still reading exactly as the account's own cap means that cap, not the rounded count its pretty
    // rendering parses back to: an admin who opens this to change the radio must not have the number moved under them.
    const draftBytes = computed<number | null>(() =>
    {
        const stored = target.value?.quotaLimit ?? null;
        if(stored !== null && draft.value === formatBytes(stored)) { return stored; }

        return parseByteSize(draft.value);
    });

    // Only a custom cap can be incomplete, and a zero typed there is the Unlimited option wearing a disguise -- the
    // three states stay distinguishable by refusing it here.
    const valid = computed(() => mode.value !== 'custom' || (draftBytes.value !== null && draftBytes.value > 0));

    // What each mode puts on the wire: null inherits the instance default, 0 pins this account unlimited, a positive
    // count caps it.
    const quotaLimit = computed<number | null>(() =>
    {
        if(mode.value === 'default') { return null; }

        return mode.value === 'unlimited' ? UNLIMITED_QUOTA : draftBytes.value;
    });

    function modeFor(limit : number | null) : QuotaMode
    {
        if(limit === null) { return 'default'; }

        return limit === UNLIMITED_QUOTA ? 'unlimited' : 'custom';
    }

    function openFor(user : AdminUserResponse) : void
    {
        target.value = user;
        mode.value = modeFor(user.quotaLimit);
        draft.value = user.quotaLimit !== null && user.quotaLimit > 0 ? formatBytes(user.quotaLimit) : '';
        open.value = true;
    }

    function onSave() : void
    {
        const user = target.value;
        if(!user || !valid.value) { return; }

        void runMutation(async () => emit('saved', await setQuota(user.id, quotaLimit.value)), pending, () =>
        {
            open.value = false;
        });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
