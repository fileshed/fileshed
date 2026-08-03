<!----------------------------------------------------------------------------------------------------------------------
  -- Selection Bar
  --
  -- The action bar shown while a selection is active, occupying the drive's constant-height idle strip. Move and Trash
  -- act on the whole selection, each offered only when the caller directly owns EVERY selected node -- one foreign
  -- node (a contribution, or a node reached through a traversed folder link) drops the action rather than acting on a
  -- subset. Copy asks only read access, so it stays keyed to node type alone (every selected node a file); Rename and
  -- Share are ownership-gated too, but only ever apply to a single selected node. Presentational -- each button emits
  -- its intent and the route component owns the targets and the mutations. The destructive button's label is passed
  -- in (Trash for files and folders, Remove for a links-only set).
  --
  -- Below lg the labels drop to their tooltips and Copy and Rename move into an overflow menu. The threshold is lg,
  -- not md, because the sidebar returns at md and leaves the content pane narrower there than one breakpoint down.
  -- Both renderings answer to the same caps, so the narrow bar never offers an action the wide one withholds.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="flex h-10 flex-1 items-center gap-2 overflow-x-auto rounded-lg bg-primary/10 px-2
            ring-1 ring-primary/20"
    >
        <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Clear selection"
            @click="emit('clear')"
        />
        <span class="shrink-0 whitespace-nowrap px-1 text-sm font-medium">{{ count }} selected</span>

        <div class="ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap">
            <UTooltip v-if="canShare" text="Share">
                <UButton
                    icon="i-lucide-user-plus"
                    color="neutral"
                    variant="subtle"
                    label="Share"
                    aria-label="Share"
                    :ui="{ label: 'hidden lg:inline' }"
                    @click="emit('share')"
                />
            </UTooltip>

            <UTooltip v-if="canMove" text="Move">
                <UButton
                    icon="i-lucide-folder-input"
                    color="neutral"
                    variant="subtle"
                    label="Move"
                    aria-label="Move"
                    :ui="{ label: 'hidden lg:inline' }"
                    @click="emit('move')"
                />
            </UTooltip>

            <UTooltip :text="copyTooltip">
                <span class="hidden lg:inline-flex">
                    <UButton
                        icon="i-lucide-copy"
                        color="neutral"
                        variant="subtle"
                        label="Copy"
                        class="disabled:pointer-events-none"
                        :disabled="!canCopy"
                        aria-label="Copy"
                        @click="emit('copy')"
                    />
                </span>
            </UTooltip>

            <UTooltip v-if="canRename" text="Rename">
                <UButton
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="subtle"
                    label="Rename"
                    class="hidden lg:inline-flex"
                    aria-label="Rename"
                    @click="emit('rename')"
                />
            </UTooltip>

            <UTooltip v-if="canTrash" :text="trashLabel">
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="subtle"
                    :label="trashLabel"
                    :aria-label="trashLabel"
                    :ui="{ label: 'hidden lg:inline' }"
                    @click="emit('trash')"
                />
            </UTooltip>

            <UDropdownMenu :items="overflowItems" :ui="{ content: 'w-48' }" class="lg:hidden">
                <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="subtle"
                    aria-label="More selection actions"
                />
            </UDropdownMenu>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        count : number;
        canCopy : boolean;
        copyTooltip : string;
        canRename : boolean;
        canShare : boolean;
        canMove : boolean;
        canTrash : boolean;
        trashLabel : string;
    }>();

    const emit = defineEmits<{
        clear : [];
        move : [];
        copy : [];
        rename : [];
        share : [];
        trash : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    // Copy rides as a disabled item rather than disappearing: the wide bar's tooltip explains why a folder can't be
    // copied, and an action that simply vanishes leaves that unsaid.
    const overflowItems = computed<DropdownMenuItem[][]>(() =>
    {
        const items : DropdownMenuItem[] = [
            { label: 'Copy', icon: 'i-lucide-copy', disabled: !props.canCopy, onSelect: () => emit('copy') },
        ];

        if(props.canRename)
        {
            items.push({ label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => emit('rename') });
        }

        return [ items ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
