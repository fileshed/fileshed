<!----------------------------------------------------------------------------------------------------------------------
  -- Sharing Badges
  --
  -- A public link shows as a globe rather than a chain, because the chain already marks a link node on the same
  -- surfaces. Icons only, with the words in the tooltip, since these sit in a tile corner and beside a truncating name.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <span v-if="peopleLabel !== null || linkLabel !== null" class="flex shrink-0 items-center gap-1">
        <UTooltip v-if="peopleLabel !== null" :text="peopleLabel">
            <UIcon name="i-lucide-users" class="size-4 text-muted" role="img" :aria-label="peopleLabel" />
        </UTooltip>
        <UTooltip v-if="linkLabel !== null" :text="linkLabel">
            <UIcon name="i-lucide-globe" class="size-4 text-primary" role="img" :aria-label="linkLabel" />
        </UTooltip>
    </span>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { NodeSharing } from '@fileshed/core';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'SharingBadges' });

    const props = defineProps<{
        sharing : NodeSharing | null;
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const peopleLabel = computed<string | null>(() =>
    {
        const count = props.sharing?.granteeCount ?? 0;
        if(count === 0) { return null; }

        return `Shared with ${ count } ${ count === 1 ? 'person' : 'people' }`;
    });

    const linkLabel = computed<string | null>(() =>
    {
        return (props.sharing?.linkUrl ?? null) === null ? null : 'Public link';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
