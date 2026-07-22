<!----------------------------------------------------------------------------------------------------------------------
  -- Account Profile
  --
  -- The identity summary at the top of the account page: avatar (initials from the display name), name, email, and an
  -- admin badge when the account is one. Read straight from the session profile.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center gap-4 rounded-lg border border-default p-4">
        <UAvatar :alt="displayName" size="lg" />
        <div class="min-w-0">
            <p class="truncate font-medium text-default">
                {{ displayName }}
            </p>
            <p class="truncate text-sm text-muted">
                {{ email }}
            </p>
        </div>
        <UBadge v-if="session.isAdmin" color="primary" variant="subtle" label="Admin" class="ml-auto" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const displayName = computed(() => session.me?.name ?? session.me?.email ?? 'Account');
    const email = computed(() => session.me?.email ?? '');
</script>

<!--------------------------------------------------------------------------------------------------------------------->
