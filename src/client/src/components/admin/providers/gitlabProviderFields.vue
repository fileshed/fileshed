<!----------------------------------------------------------------------------------------------------------------------
  -- GitLab Provider Fields
  --
  -- GitLab's extra knob earns its place in a self-hosting crowd: the issuer points the OAuth flow at a self-hosted
  -- GitLab instead of gitlab.com.
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
            key: 'GITLAB_CLIENT_ID',
            label: 'Application ID',
            description: 'From the GitLab OAuth application.',
        },
        {
            key: 'GITLAB_CLIENT_SECRET',
            label: 'Secret',
            description: 'Stored encrypted; shown only as its last characters. Entering a value replaces it.',
        },
        {
            key: 'GITLAB_ISSUER',
            label: 'Issuer URL',
            description: 'Optional: your self-hosted GitLab\'s base URL, e.g. https://gitlab.example.com. Leave '
                + 'unset for gitlab.com.',
        },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
