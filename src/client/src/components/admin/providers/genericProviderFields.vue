<!----------------------------------------------------------------------------------------------------------------------
  -- Generic Provider Fields
  --
  -- The credential pair almost every OAuth provider runs on. Providers whose contract wants more get their own
  -- component behind the providerFields wrapper; this one stays deliberately two fields.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <ProviderFieldList :fields="fields" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { type SocialProviderID, providerCredentialKeys } from '@fileshed/core';

    // Components
    import ProviderFieldList from './providerFieldList.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ provider : SocialProviderID }>();

    const fields = computed(() =>
    {
        const keys = providerCredentialKeys(props.provider);

        return [
            {
                key: keys.clientID,
                label: 'Client ID',
                description: 'From the provider\'s OAuth app. The provider appears on the sign-in page only when '
                    + 'every required field is set.',
            },
            {
                key: keys.clientSecret,
                label: 'Client secret',
                description: 'Stored encrypted; shown only as its last characters. Entering a value replaces it.',
            },
        ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
