<!----------------------------------------------------------------------------------------------------------------------
  -- Sharing Badges
  --
  -- What a node currently reaches beyond its owner, as icons: people when someone holds a grant, a globe when a live
  -- public link stands. A globe rather than a chain, which already marks a link NODE on these same surfaces. The two
  -- are independent -- "I gave someone access" and "anyone with the URL can fetch this" are different sharings -- so
  -- both can show at once. Icons only: the tooltip carries the words, since these sit in a tile corner and beside a
  -- truncating name. A node with nothing to report renders nothing at all.
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
