<!----------------------------------------------------------------------------------------------------------------------
  -- Top Bar
  --
  -- The header shared by the drive-chrome layouts: the file search box and the user menu. Both are self-contained
  -- pieces, so the drive shell and the account shell mount this without wiring anything through.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <header class="flex items-center justify-between gap-4 border-b border-default p-4">
        <SearchBox />

        <UserMenu />
    </header>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import SearchBox from './searchBox.vue';
    import UserMenu from './userMenu.vue';
</script>

<!--------------------------------------------------------------------------------------------------------------------->
