<!----------------------------------------------------------------------------------------------------------------------
  -- User Summary Hover
  --
  -- Wraps a trigger (an avatar, a name, whatever the caller slots in) in a focusable button so the summary card opens
  -- on keyboard focus as well as hover -- callers never have to remember the a11y wiring themselves.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UPopover mode="hover" :open-delay="150">
        <button
            type="button"
            class="cursor-default rounded-full focus-visible:outline focus-visible:outline-2
                focus-visible:outline-primary focus-visible:outline-offset-2"
        >
            <slot />
        </button>

        <template #content>
            <div class="flex items-center gap-3 p-3">
                <UAvatar :src="summary.image ?? undefined" :alt="summary.name" size="md" />
                <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                        {{ summary.name }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ summary.email }}
                    </p>
                </div>
            </div>
        </template>
    </UPopover>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { UserSummary } from '@fileshed/core';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        summary : UserSummary;
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
