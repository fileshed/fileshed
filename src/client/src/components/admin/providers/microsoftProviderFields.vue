<!----------------------------------------------------------------------------------------------------------------------
  -- Microsoft Provider Fields
  --
  -- Microsoft Entra ID adds one knob that matters: the tenant. The default ("common") accepts any Microsoft
  -- account; a specific tenant id restricts sign-in to one organization.
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
            key: 'MICROSOFT_CLIENT_ID',
            label: 'Application (client) ID',
            description: 'From the Entra ID app registration.',
        },
        {
            key: 'MICROSOFT_CLIENT_SECRET',
            label: 'Client secret',
            description: 'Stored encrypted; shown only as its last characters. Entering a value replaces it.',
        },
        {
            key: 'MICROSOFT_TENANT_ID',
            label: 'Tenant',
            description: 'Optional: a tenant id restricts sign-in to that organization. Leave unset to accept any '
                + 'Microsoft account.',
        },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
