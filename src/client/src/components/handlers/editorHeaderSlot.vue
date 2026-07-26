<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Header Slot
  --
  -- The seam a handler family uses to contribute its identity into the editor layout's header. It teleports its slot
  -- into the header's center region (#editor-header-center), so a family renders its name + action cluster wherever it
  -- lives in the tree and the chrome lands in the header.
  --
  -- The target lives in editorLayout, a different component tree, so <Teleport defer> is no help -- defer only resolves a
  -- target rendered later within this same tree, and teleporting to a wholly-absent target warns. A mounted-target check
  -- gates the Teleport instead: the target is always present under the real layout, and skipped in an isolated unit
  -- mount, so a family spec renders nothing into the void rather than tripping a Teleport warning.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <Teleport v-if="present" to="#editor-header-center">
        <div class="flex min-w-0 flex-1 items-center gap-3">
            <slot />
        </div>
    </Teleport>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';

    //------------------------------------------------------------------------------------------------------------------

    const HEADER_TARGET_ID = 'editor-header-center';

    const present = ref(false);

    onMounted(() => { present.value = document.getElementById(HEADER_TARGET_ID) !== null; });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
