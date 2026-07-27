<!----------------------------------------------------------------------------------------------------------------------
  -- Tokens Tab
  --
  -- The account area's access-token tab: mint above, inventory below. The tab only coordinates the refresh after a
  -- mint; each section owns its own data and mutation.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-8">
        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Access tokens
            </h2>
            <p class="text-sm text-muted">
                Tokens act as you, within the scopes you choose, sent as a
                <code class="text-xs">Authorization: Bearer</code> header. They outlive sign-outs and password
                changes; revoke them here when they should stop.
            </p>
            <CreateAccessToken @created="list?.refresh()" />
        </section>

        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Your tokens
            </h2>
            <AccessTokenList ref="list" />
        </section>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { useTemplateRef } from 'vue';

    // Components
    import AccessTokenList from '../../components/account/tokens/accessTokenList.vue';
    import CreateAccessToken from '../../components/account/tokens/createAccessToken.vue';

    //------------------------------------------------------------------------------------------------------------------

    const list = useTemplateRef('list');
</script>

<!--------------------------------------------------------------------------------------------------------------------->
