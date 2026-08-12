<!----------------------------------------------------------------------------------------------------------------------
  -- Capped Notice
  --
  -- What a listing says for itself when it is too big to hold whole: it loads as the user scrolls rather than all at
  -- once, and the surface says so where the listing can be seen rather than letting it feel broken.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :description="notice"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { MAX_COMPLETE_LISTING } from '@fileshed/core';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        subject : string;
    }>();

    const notice = computed(() =>
    {
        return `This ${ props.subject } has more than ${ MAX_COMPLETE_LISTING.toLocaleString() } items. `
            + 'It loads as you scroll, and sorting and filtering are handled by the server.';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
