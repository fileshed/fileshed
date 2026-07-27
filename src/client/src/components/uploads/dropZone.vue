<!----------------------------------------------------------------------------------------------------------------------
  -- Drop Zone
  --
  -- Wraps a surface and turns a file drag over it into an upload. A drag carrying files raises an overlay naming the
  -- target folder; a drop emits what it carried for the parent to enqueue -- FileSystemEntry handles when the browser
  -- offers them (they can name whole folders, and MUST be collected synchronously inside the drop event or they go
  -- stale) plus the plain File list as the fallback. Dragging over child elements fires a stream of enter/leave
  -- events, so a depth counter (not a boolean) drives the overlay -- it stays up until the drag has truly left the
  -- surface, not just crossed onto a child. Only file drags are tracked, so dragging a node selection does nothing.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="relative flex flex-col"
        @dragenter="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop="onDrop"
    >
        <slot />

        <div
            v-if="dragging"
            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg
                border-2 border-dashed border-primary bg-primary/10"
        >
            <div class="flex flex-col items-center gap-2 text-primary">
                <UIcon name="i-lucide-upload-cloud" class="size-10" />
                <p class="text-sm font-medium">
                    Drop files or folders to upload to {{ label }}
                </p>
            </div>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{ label : string }>();

    const emit = defineEmits<{
        'drop-upload' : [ entries : FileSystemEntry[], files : File[] ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const depth = ref(0);
    const dragging = computed(() => depth.value > 0);

    function carriesFiles(event : DragEvent) : boolean
    {
        return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    }

    function onDragEnter(event : DragEvent) : void
    {
        if(carriesFiles(event)) { depth.value += 1; }
    }

    function onDragLeave() : void
    {
        depth.value = Math.max(0, depth.value - 1);
    }

    function onDrop(event : DragEvent) : void
    {
        event.preventDefault();
        depth.value = 0;

        const entries = Array.from(event.dataTransfer?.items ?? [])
            .map((item) => { return typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null; })
            .filter((entry) : entry is FileSystemEntry => entry !== null);
        const files = Array.from(event.dataTransfer?.files ?? []);

        if(entries.length > 0 || files.length > 0) { emit('drop-upload', entries, files); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
