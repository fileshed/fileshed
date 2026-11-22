<!----------------------------------------------------------------------------------------------------------------------
  -- Save Indicator
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div v-if="label" class="flex items-center gap-1.5">
        <span :class="[ 'text-sm', tone ]">{{ label }}</span>
        <UButton
            v-if="saveError !== null"
            icon="i-lucide-rotate-cw"
            label="Retry"
            color="error"
            variant="soft"
            size="xs"
            @click="emit('retry')"
        />
    </div>
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

    const emit = defineEmits<{
        retry : [];
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
