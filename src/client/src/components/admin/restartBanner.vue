<!----------------------------------------------------------------------------------------------------------------------
  -- Restart Banner
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UAlert
        v-if="settings.restartRequired"
        color="warning"
        variant="subtle"
        icon="i-lucide-refresh-cw"
        title="Restart required"
        description="A changed setting only takes effect after the server restarts."
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    //------------------------------------------------------------------------------------------------------------------

    const settings = useAdminSettingsStore();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
