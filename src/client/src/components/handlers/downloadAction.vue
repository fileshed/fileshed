<!----------------------------------------------------------------------------------------------------------------------
  -- Download Action
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UTooltip text="Download">
        <UButton
            icon="i-lucide-download"
            color="neutral"
            variant="ghost"
            aria-label="Download"
            :href="href"
        />
    </UTooltip>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Resource Access
    import { downloadUrl } from '../../resource-access/downloads.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'DownloadAction' });

    const props = defineProps<{
        nodeID : string;
    }>();

    const href = computed(() => downloadUrl(props.nodeID));
</script>

<!--------------------------------------------------------------------------------------------------------------------->
