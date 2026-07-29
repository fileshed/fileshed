<!----------------------------------------------------------------------------------------------------------------------
  -- Cognito Provider Fields
  --
  -- Amazon Cognito cannot function on a credential pair alone: its hosted-UI domain, region, and user-pool id are
  -- part of the OAuth endpoints themselves, so all five fields must be set before the provider activates.
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
            key: 'COGNITO_CLIENT_ID',
            label: 'App client ID',
            description: 'From the user pool\'s app client.',
        },
        {
            key: 'COGNITO_CLIENT_SECRET',
            label: 'App client secret',
            description: 'Stored encrypted; shown only as its last characters. Entering a value replaces it.',
        },
        {
            key: 'COGNITO_DOMAIN',
            label: 'Hosted UI domain',
            description: 'The Cognito domain serving the hosted sign-in, e.g. auth.example.com or '
                + 'your-prefix.auth.us-east-1.amazoncognito.com.',
        },
        {
            key: 'COGNITO_REGION',
            label: 'Region',
            description: 'The AWS region the user pool lives in, e.g. us-east-1.',
        },
        {
            key: 'COGNITO_USER_POOL_ID',
            label: 'User pool ID',
            description: 'e.g. us-east-1_AbCdEfGhI.',
        },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
