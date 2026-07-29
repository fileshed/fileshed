<!----------------------------------------------------------------------------------------------------------------------
  -- Provider Fields
  --
  -- The one component the Authentication tab mounts per provider: it takes the provider id and switches to the
  -- component that fits -- a specific one where the provider's OAuth contract wants more than a credential pair,
  -- the generic two-field one everywhere else. Adding provider-specific handling is adding a component to the map,
  -- nothing more.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <component :is="fieldsComponent" :provider="provider" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { type Component, computed } from 'vue';

    import type { SocialProviderID } from '@fileshed/core';

    // Components
    import AppleProviderFields from './appleProviderFields.vue';
    import CognitoProviderFields from './cognitoProviderFields.vue';
    import GenericProviderFields from './genericProviderFields.vue';
    import GitlabProviderFields from './gitlabProviderFields.vue';
    import MicrosoftProviderFields from './microsoftProviderFields.vue';
    import TiktokProviderFields from './tiktokProviderFields.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ provider : SocialProviderID }>();

    const SPECIFIC_FIELDS : Partial<Record<SocialProviderID, Component>> = {
        apple: AppleProviderFields,
        cognito: CognitoProviderFields,
        gitlab: GitlabProviderFields,
        microsoft: MicrosoftProviderFields,
        tiktok: TiktokProviderFields,
    };

    const fieldsComponent = computed(() => SPECIFIC_FIELDS[props.provider] ?? GenericProviderFields);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
