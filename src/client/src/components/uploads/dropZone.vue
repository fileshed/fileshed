<!----------------------------------------------------------------------------------------------------------------------
  -- Drop Zone
  --
  -- FileSystemEntry handles (which can name whole folders) must be collected synchronously inside the drop event or
  -- they go stale; the plain File list comes along as the fallback. Dragging over child elements fires a stream of
  -- enter and leave events, so a depth counter rather than a boolean drives the overlay.
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
