<!----------------------------------------------------------------------------------------------------------------------
  -- Save Indicator
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <span v-if="label" :class="[ 'text-sm', tone ]">{{ label }}</span>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        saving : boolean;
        dirty : boolean;
        lastSaved : number | null;
        saveError : string | null;
    }>();

    const label = computed<string>(() =>
    {
        if(props.saveError !== null) { return 'Couldn\'t save'; }
        if(props.saving) { return 'Saving…'; }
        if(props.dirty) { return 'Unsaved changes'; }
        if(props.lastSaved !== null) { return 'Saved'; }
        return '';
    });

    const tone = computed<string>(() =>
    {
        return props.saveError !== null ? 'text-error' : 'text-dimmed';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
