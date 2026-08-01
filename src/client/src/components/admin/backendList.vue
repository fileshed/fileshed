<!----------------------------------------------------------------------------------------------------------------------
  -- Backend List
  --
  -- The configured storage backends, default one badged. A row never carries the backend's config blob -- it can hold
  -- credentials, and the server does not send it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold text-highlighted">
            Storage backends
        </h2>

        <div
            v-for="backend of backends"
            :key="backend.id"
            class="flex items-center gap-3 rounded-lg border border-default p-4"
        >
            <UIcon name="i-lucide-hard-drive" class="size-5 text-muted" />
            <span class="font-medium">{{ backend.kind }}</span>
            <UBadge
                v-if="backend.isDefault"
                label="Default"
                color="primary"
                variant="subtle"
                size="sm"
            />
            <span class="ml-auto truncate font-mono text-xs text-muted">{{ backend.id }}</span>
        </div>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { StorageBackendStatus } from '@fileshed/core';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{ backends : StorageBackendStatus[] }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
