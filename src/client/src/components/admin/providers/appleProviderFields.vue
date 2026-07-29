<!----------------------------------------------------------------------------------------------------------------------
  -- Apple Provider Fields
  --
  -- Sign in with Apple's "client secret" is not a static string: it is a JWT the operator signs with their Apple
  -- private key, and Apple caps its lifetime at six months -- the guidance up top exists because the provider will
  -- otherwise fail mysteriously when it expires. The bundle identifier only matters for native-app token flows.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UAlert
        color="info"
        variant="soft"
        icon="i-lucide-clock"
        description="Apple's client secret is a JWT you generate and sign with your Apple private key, valid at
            most six months — set a reminder to regenerate it before it expires."
    />

    <ProviderFieldList :fields="fields" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import ProviderFieldList, { type ProviderFieldDescriptor } from './providerFieldList.vue';

    //------------------------------------------------------------------------------------------------------------------

    const fields : ProviderFieldDescriptor[] = [
        {
            key: 'APPLE_CLIENT_ID',
            label: 'Services ID (client ID)',
            description: 'The Services ID from your Apple developer account, e.g. com.example.shed.signin.',
        },
        {
            key: 'APPLE_CLIENT_SECRET',
            label: 'Client secret (signed JWT)',
            description: 'The generated JWT, stored encrypted and shown only as its last characters. Expires within '
                + 'six months of signing.',
        },
        {
            key: 'APPLE_APP_BUNDLE_IDENTIFIER',
            label: 'App bundle identifier',
            description: 'Optional; only needed when a native app signs in with Apple-issued ID tokens.',
        },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
