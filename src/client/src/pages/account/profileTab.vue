<!----------------------------------------------------------------------------------------------------------------------
  -- Profile Tab
  --
  -- The account area's public-identity tab: the avatar with its edit button beneath, the name with the email muted
  -- under it, and the editable display name. The avatar and the "Change avatar" button both open the avatar editor;
  -- there is no menu on the avatar itself. The name is a plain form field -- Save is live only for a non-empty,
  -- changed value -- rather than an inline edit. The Admin badge sits beside the name, decoupled from any action.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-8">
        <section class="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div class="flex shrink-0 flex-col items-center gap-3">
                <button
                    type="button"
                    class="cursor-pointer rounded-full"
                    aria-label="Change avatar"
                    @click="openAvatarEdit"
                >
                    <UAvatar
                        :src="avatarUrl"
                        :alt="displayName"
                        size="3xl"
                        :ui="{ root: 'size-24', fallback: 'text-3xl' }"
                    />
                </button>
                <UButton
                    icon="i-lucide-camera"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    label="Change avatar"
                    @click="openAvatarEdit"
                />
            </div>

            <div class="flex w-full min-w-0 flex-col items-center gap-1 sm:w-auto sm:items-start sm:pt-4">
                <div class="flex max-w-full items-center gap-2">
                    <h2 class="truncate text-lg font-semibold text-highlighted">
                        {{ displayName }}
                    </h2>
                    <UBadge v-if="session.isAdmin" color="secondary" variant="subtle" label="Admin" />
                </div>
                <p class="truncate text-sm text-muted">
                    {{ email }}
                </p>
            </div>
        </section>

        <div class="flex max-w-md flex-col gap-4">
            <UFormField label="Display name">
                <div class="flex items-start gap-2">
                    <UInput v-model="nameDraft" class="flex-1" @keydown.enter="saveName" />
                    <UButton label="Save" :loading="namePending" :disabled="!nameDirty" @click="saveName" />
                </div>
            </UFormField>
        </div>

        <AvatarEditModal ref="avatarEditRef" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Components
    import AvatarEditModal from '../../components/account/modals/avatarEditModal.vue';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const displayName = computed(() => session.me?.name ?? session.me?.email ?? 'Account');
    const email = computed(() => session.me?.email ?? '');
    const avatarUrl = computed(() => session.me?.image ?? undefined);

    //------------------------------------------------------------------------------------------------------------------
    // Avatar
    //------------------------------------------------------------------------------------------------------------------

    const avatarEditRef = ref<{ open : () => void } | null>(null);

    function openAvatarEdit() : void
    {
        avatarEditRef.value?.open();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Display name
    //------------------------------------------------------------------------------------------------------------------

    const namePending = ref(false);
    const storedName = computed(() => session.me?.name ?? '');
    const nameDraft = ref(storedName.value);

    // A name must be non-empty and actually different to be worth saving.
    const nameDirty = computed(() =>
    {
        const trimmed = nameDraft.value.trim();
        return trimmed !== '' && trimmed !== storedName.value;
    });

    function saveName() : void
    {
        if(!nameDirty.value) { return; }

        const trimmed = nameDraft.value.trim();

        void runMutation(() => session.updateName(trimmed), namePending, () =>
        {
            // Adopt the value the server settled on (its own trim), so the field matches what was saved.
            nameDraft.value = storedName.value;
        });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
