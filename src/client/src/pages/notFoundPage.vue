<!----------------------------------------------------------------------------------------------------------------------
  -- Not Found Page
  --
  -- Where every unmatched URL lands. It stands alone rather than inside the drive shell: the catch-all is reachable
  -- signed in or not, and the shell's chrome assumes a session.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen flex-col items-center justify-center gap-8 bg-default p-6 text-default">
        <RouterLink to="/" class="flex items-center gap-2 text-xl font-bold">
            <img :src="app.logoUrl" alt="" class="size-8">
            {{ app.name }}
        </RouterLink>

        <div class="flex flex-col items-center gap-2 text-center">
            <p class="text-7xl font-bold text-muted">
                404
            </p>
            <h1 class="text-xl font-bold">
                This page doesn't exist
            </h1>
            <p class="max-w-sm text-sm text-muted">
                The link may be broken, or whatever was here has moved.
            </p>
        </div>

        <div class="flex flex-wrap items-center justify-center gap-3">
            <UButton to="/" icon="i-lucide-folder" label="Back to Files" />
            <UButton
                icon="i-lucide-arrow-left"
                label="Go back"
                color="neutral"
                variant="subtle"
                @click="goBack"
            />
        </div>
    </main>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { RouterLink, useRouter } from 'vue-router';

    // Stores
    import { useAppStore } from '../stores/app.ts';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const router = useRouter();

    // A 404 is usually reached from outside -- a stale link, a typed URL -- where a lone tab entry means history.back()
    // would sit dead. Landing on the drive instead keeps the button from lying.
    function goBack() : void
    {
        if(window.history.length > 1)
        {
            router.back();
            return;
        }

        void router.replace('/');
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
