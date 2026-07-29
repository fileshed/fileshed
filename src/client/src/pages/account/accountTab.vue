<!----------------------------------------------------------------------------------------------------------------------
  -- Account Tab
  --
  -- The account area's account-management tab: the storage summary, the password change control, and the connected
  -- sign-in methods. Each owns its own data and mutation; the tab only groups them under section headings.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-8">
        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Storage
            </h2>
            <AccountStorage />
        </section>

        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Password
            </h2>
            <ChangePassword />
        </section>

        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Connected accounts
            </h2>
            <ConnectedAccounts />
        </section>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import AccountStorage from '../../components/account/accountStorage.vue';
    import ChangePassword from '../../components/account/changePassword.vue';
    import ConnectedAccounts from '../../components/account/connectedAccounts.vue';
</script>

<!--------------------------------------------------------------------------------------------------------------------->
