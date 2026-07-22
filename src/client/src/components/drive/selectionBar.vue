<!----------------------------------------------------------------------------------------------------------------------
  -- Selection Bar
  --
  -- The action bar shown while a selection is active, occupying the drive's constant-height idle strip. Move and Trash
  -- act on the whole selection; Copy is offered only when every selected node is a file; Rename only for a single,
  -- renamable node. Presentational -- each button emits its intent and the route component owns the targets and the
  -- mutations. The destructive button's label is passed in (Trash for files and folders, Remove for a links-only set).
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
        <span class="px-1 text-sm font-medium">{{ count }} selected</span>

        <div class="ml-2 flex items-center gap-1 whitespace-nowrap">
            <UTooltip text="Move">
                <UButton
                    icon="i-lucide-folder-input"
                    color="neutral"
                    variant="subtle"
                    label="Move"
                    aria-label="Move"
                    @click="emit('move')"
                />
            </UTooltip>

            <UTooltip :text="copyTooltip">
                <span class="inline-flex">
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
                    aria-label="Rename"
                    @click="emit('rename')"
                />
            </UTooltip>

            <UTooltip :text="trashLabel">
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="subtle"
                    :label="trashLabel"
                    :aria-label="trashLabel"
                    @click="emit('trash')"
                />
            </UTooltip>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    defineProps<{
        count : number;
        canCopy : boolean;
        copyTooltip : string;
        canRename : boolean;
        trashLabel : string;
    }>();

    const emit = defineEmits<{
        clear : [];
        move : [];
        copy : [];
        rename : [];
        trash : [];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
