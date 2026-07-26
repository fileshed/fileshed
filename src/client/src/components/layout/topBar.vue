<!----------------------------------------------------------------------------------------------------------------------
  -- Top Bar
  --
  -- The header shared by the drive-chrome layouts: the file search box and the user menu. It owns its own search
  -- submission; the user menu is a self-contained piece, so both the drive shell and the account shell mount this
  -- without wiring anything through.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <header class="flex items-center justify-between gap-4 border-b border-default p-4">
        <UInput
            v-model="searchTerm"
            icon="i-lucide-search"
            placeholder="Search files…"
            class="max-w-md flex-1"
            @keydown.enter="submitSearch"
        />

        <UserMenu />
    </header>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';
    import { useRouter } from 'vue-router';

    // Components
    import UserMenu from './userMenu.vue';

    //------------------------------------------------------------------------------------------------------------------

    const router = useRouter();

    //------------------------------------------------------------------------------------------------------------------
    // Search
    //------------------------------------------------------------------------------------------------------------------

    const searchTerm = ref('');

    async function submitSearch() : Promise<void>
    {
        const term = searchTerm.value.trim();
        if(term.length === 0) { return; }

        await router.push({ path: '/search', query: { q: term } });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
