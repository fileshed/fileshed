<!----------------------------------------------------------------------------------------------------------------------
  -- TikTok Provider Fields
  --
  -- TikTok's OAuth authenticates with a client KEY rather than a client id -- the pair here is key + secret, and
  -- the generic id field would be a lie.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <ProviderFieldList :fields="fields" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import ProviderFieldList, { type ProviderFieldDescriptor } from './providerFieldList.vue';

    //------------------------------------------------------------------------------------------------------------------

    const fields : ProviderFieldDescriptor[] = [
        {
            key: 'TIKTOK_CLIENT_KEY',
            label: 'Client key',
            description: 'From the TikTok developer app. TikTok uses this where other providers use a client ID.',
        },
        {
            key: 'TIKTOK_CLIENT_SECRET',
            label: 'Client secret',
            description: 'Stored encrypted; shown only as its last characters. Entering a value replaces it.',
        },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
