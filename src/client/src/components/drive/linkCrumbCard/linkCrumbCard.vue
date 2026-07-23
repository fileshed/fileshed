<!----------------------------------------------------------------------------------------------------------------------
  -- Link Crumb Card
  --
  -- A breadcrumb crumb that is a folder link: the label carries the same link-badge marker the drive rows put on a
  -- link's icon, and the crumb reveals a hover card (mouse or keyboard focus) naming the target it links to, the
  -- target's owner, and whether the link is broken. The RouterLink is the popover trigger, so focusing the crumb opens
  -- the card just as hovering does.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UPopover mode="hover" :open-delay="150">
        <RouterLink
            :to="to"
            class="inline-flex items-center gap-1.5 rounded focus-visible:outline focus-visible:outline-2
                focus-visible:outline-primary focus-visible:outline-offset-2"
        >
            <span class="relative shrink-0" :class="{ 'opacity-40': dead }">
                <UIcon :name="presentation.icon" class="size-4" :class="presentation.color" />
                <UIcon
                    v-if="!dead"
                    name="i-lucide-link"
                    class="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-default text-muted"
                />
            </span>
            <span class="truncate" :class="{ 'text-dimmed': dead }">{{ node.name }}</span>
        </RouterLink>

        <template #content>
            <div class="flex max-w-xs flex-col gap-2 p-3">
                <p v-if="!dead" class="text-sm">
                    Links to <span class="font-medium">{{ targetName }}</span>
                </p>

                <div v-if="owner !== null" class="flex items-center gap-2">
                    <UAvatar :src="owner.image ?? undefined" :alt="owner.name" size="xs" />
                    <span class="truncate text-xs text-muted">{{ owner.name }}</span>
                </div>

                <p v-if="dead" class="text-sm text-error">
                    This link is broken — its target is no longer available.
                </p>
            </div>
        </template>
    </UPopover>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { NodeResponse, UserSummary } from '@fileshed/core';

    // Utils
    import { isDeadLink, nodePresentation } from '../../../utils/nodeTypePresentation.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
        owner : UserSummary | null;
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const to = computed(() => `/folder/${ props.node.id }`);
    const presentation = computed(() => nodePresentation(props.node));
    const dead = computed(() => isDeadLink(props.node));
    const targetName = computed(() => (props.node.type === 'link' ? props.node.target?.name : undefined) ?? null);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
