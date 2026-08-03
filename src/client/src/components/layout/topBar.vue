<!----------------------------------------------------------------------------------------------------------------------
  -- Top Bar
  --
  -- The header shared by the drive-chrome layouts: the file search box and the user menu. Both are self-contained
  -- pieces, so the shell mounts this without wiring anything through. The #leading slot is where the shell hangs its
  -- narrow-viewport navigation trigger.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <header class="flex items-center justify-between gap-2 border-b border-default p-3 sm:gap-4 sm:p-4">
        <slot name="leading" />

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
