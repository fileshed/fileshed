<!----------------------------------------------------------------------------------------------------------------------
  -- Save Indicator
  --
  -- The one-line save-state readout the editing families show beside their Save button. Priority order: a save error
  -- outranks everything, then an in-flight save, then unsaved changes, then a settled "Saved" once at least one save has
  -- landed. A clean session that has never saved shows nothing.
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
        lastSavedAt : number | null;
        saveError : string | null;
    }>();

    const label = computed<string>(() =>
    {
        if(props.saveError !== null) { return 'Couldn\'t save'; }
        if(props.saving) { return 'Saving…'; }
        if(props.dirty) { return 'Unsaved changes'; }
        if(props.lastSavedAt !== null) { return 'Saved'; }
        return '';
    });

    const tone = computed<string>(() =>
    {
        return props.saveError !== null ? 'text-error' : 'text-dimmed';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
