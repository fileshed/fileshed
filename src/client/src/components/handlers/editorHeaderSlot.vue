<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Header Slot
  --
  -- The target lives in editorLayout, a different component tree, so <Teleport defer> is no help: defer only resolves a
  -- target rendered later within the same tree, and teleporting to an absent target warns. A mounted-target check
  -- guards the Teleport instead. The target is always present under the real layout and absent in an isolated unit
  -- mount, so a family spec renders nothing rather than tripping a Teleport warning.
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
