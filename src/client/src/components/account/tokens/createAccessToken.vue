<!----------------------------------------------------------------------------------------------------------------------
  -- Create Access Token
  --
  -- The mint form. Scopes are explicit checkboxes; the preset buttons only tick them, so what is stored is exactly
  -- what is shown. A successful mint hands the one-time value to the reveal modal and resets the form immediately --
  -- the secret's whole client-side life happens inside the modal.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Create a token
        </h3>
        <p class="mt-1 text-sm text-muted">
            For scripts, tools, and anything else that needs to act as you without a browser session.
        </p>

        <div class="mt-3 flex flex-col gap-4">
            <UFormField label="Name" help="What is this token for? Shown in the list, never to the API.">
                <UInput v-model="name" placeholder="my backup script" class="w-full max-w-md" />
            </UFormField>

            <UFormField label="Scopes">
                <div class="mb-2 flex gap-2">
                    <UButton
                        label="Full access"
                        color="neutral"
                        variant="subtle"
                        size="xs"
                        @click="applyPreset(fullAccessPreset)"
                    />
                    <UButton
                        label="Read-only"
                        color="neutral"
                        variant="subtle"
                        size="xs"
                        @click="applyPreset(readOnlyPreset)"
                    />
                    <UButton
                        label="Clear"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        @click="selected = []"
                    />
                </div>

                <div class="flex flex-col gap-2">
                    <div v-for="entry in scopeCatalog" :key="entry.scope" class="flex items-start gap-2">
                        <UCheckbox
                            :model-value="selected.includes(entry.scope)"
                            :aria-label="entry.label"
                            @update:model-value="toggle(entry.scope, $event === true)"
                        />
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-medium text-default">{{ entry.label }}</span>
                                <UBadge v-if="entry.danger" color="error" variant="subtle" size="sm">
                                    Can publish
                                </UBadge>
                            </div>
                            <p class="text-xs text-muted">
                                {{ entry.description }}
                            </p>
                        </div>
                    </div>
                </div>
            </UFormField>

            <UFormField label="Expires" help="An expired token stops working on its own. Choose deliberately.">
                <USelect v-model="expiry" :items="expiryChoices" class="w-44" />
            </UFormField>

            <div class="flex justify-end">
                <UButton
                    label="Create token"
                    :loading="pending"
                    :disabled="!canSubmit"
                    @click="submit"
                />
            </div>
        </div>

        <RevealToken ref="reveal" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, useTemplateRef } from 'vue';

    import type { AccessTokenScope, CreateAccessTokenResponse } from '@fileshed/core';

    // Resource Access
    import { createAccessToken } from '../../../resource-access/accessTokens.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    // Components
    import RevealToken from './modals/revealToken.vue';

    // Catalog
    import { fullAccessPreset, readOnlyPreset, scopeCatalog } from './scopeCatalog.ts';

    //------------------------------------------------------------------------------------------------------------------

    const emit = defineEmits<{
        created : [];
    }>();

    const { runMutation } = useRunWithToast();

    const reveal = useTemplateRef('reveal');

    const pending = ref(false);
    const name = ref('');
    const selected = ref<AccessTokenScope[]>([]);
    const expiry = ref('90');

    const expiryChoices = [
        { label: '30 days', value: '30' },
        { label: '90 days', value: '90' },
        { label: '1 year', value: '365' },
        { label: 'No expiry', value: 'never' },
    ];

    const canSubmit = computed(() => name.value.trim() !== '' && selected.value.length > 0);

    //------------------------------------------------------------------------------------------------------------------

    function toggle(scope : AccessTokenScope, checked : boolean) : void
    {
        const others = selected.value.filter((existing) => existing !== scope);
        selected.value = checked ? [ ...others, scope ] : others;
    }

    function applyPreset(preset : AccessTokenScope[]) : void
    {
        selected.value = [ ...preset ];
    }

    function submit() : void
    {
        if(!canSubmit.value) { return; }

        const expiresInDays = expiry.value === 'never' ? null : Number(expiry.value);
        let minted : CreateAccessTokenResponse | null = null;

        void runMutation(
            async () =>
            {
                minted = await createAccessToken(name.value.trim(), selected.value, expiresInDays);
            },
            pending,
            () =>
            {
                if(minted !== null) { reveal.value?.open(minted.token); }
                name.value = '';
                selected.value = [];
                expiry.value = '90';
                emit('created');
            }
        );
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
