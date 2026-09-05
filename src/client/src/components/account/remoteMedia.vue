<!----------------------------------------------------------------------------------------------------------------------
  -- Remote Media
  --
  -- The account-page toggle for playing playlist entries that point off this instance. It is the reader's own switch,
  -- not the sharer's: a playlist is something one user hands another, and this decides whether the recipient's browser
  -- answers a URL somebody else chose. On by default, since remote entries are an ordinary part of a playlist file.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center justify-between gap-4 rounded-lg border border-default p-4">
        <div class="min-w-0">
            <h3 class="flex flex-wrap items-center gap-2 font-medium text-default">
                Media from other sites
                <UBadge
                    label="Privacy"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                />
            </h3>
            <p class="mt-1 text-sm text-muted">
                A playlist can point at a file hosted somewhere else, including a playlist someone shared with you.
                Playing one asks that site for the file, which tells whoever runs it your IP address and when you
                opened it. Turned off, those entries stay in the list and are never fetched.
            </p>
        </div>

        <USwitch
            :model-value="session.allowRemoteMedia"
            :disabled="pending"
            @update:model-value="choose"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    function choose(allowed : boolean) : void
    {
        void runMutation(() => session.savePreferences({ allowRemoteMedia: allowed }), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
