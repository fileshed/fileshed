<!----------------------------------------------------------------------------------------------------------------------
  -- Main Layout
  --
  -- The primary authenticated chrome: sidebar navigation, header with the user menu, and the routed content. Auth
  -- pages render outside this layout (sibling routes), so it can assume a signed-in user. It is a fixed-viewport app
  -- shell: the outer frame is pinned to the viewport (h-screen) and only <main> scrolls, so the sidebar and header stay
  -- put on every page and a route that fills the height (the file editor) gets a real height to bound its own scroller
  -- against instead of growing the page.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-screen overflow-hidden bg-default text-default">
        <aside class="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-default p-4">
            <RouterLink to="/" class="mb-6 flex items-center gap-2 px-2 text-xl font-bold">
                <img src="/fileshed.svg" alt="" class="size-8">
                {{ app.name }}
            </RouterLink>

            <UDropdownMenu :items="newMenuItems" :ui="{ content: 'w-56' }" class="mb-4">
                <UButton icon="i-lucide-plus" label="New" color="primary" size="lg" block class="justify-center" />
            </UDropdownMenu>

            <UNavigationMenu
                orientation="vertical"
                :items="navItems"
                class="flex-1"
            />

            <QuotaMeter class="mt-4" />
        </aside>

        <div class="flex min-w-0 flex-1 flex-col">
            <TopBar />

            <main class="min-h-0 min-w-0 flex-1 overflow-auto p-6">
                <RouterView />
            </main>
        </div>

        <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesPicked">

        <UploadPanel />
        <UploadCollision />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
    import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';
    import { type NewItemKind, useNewItemStore } from '../stores/newItem.ts';
    import { useDriveStore } from '../stores/drive.ts';
    import { useUploadsStore } from '../stores/uploads.ts';

    // Components
    import TopBar from '../components/layout/topBar.vue';
    import QuotaMeter from '../components/quotaMeter.vue';
    import UploadPanel from '../components/uploads/uploadPanel.vue';
    import UploadCollision from '../components/uploads/modals/uploadCollision.vue';

    //------------------------------------------------------------------------------------------------------------------
    // Stores
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();
    const newItem = useNewItemStore();
    const drive = useDriveStore();
    const uploads = useUploadsStore();
    const route = useRoute();
    const router = useRouter();

    //------------------------------------------------------------------------------------------------------------------
    // Navigation
    //------------------------------------------------------------------------------------------------------------------

    const navItems = computed<NavigationMenuItem[]>(() => [
        { label: session.rootLabel, icon: 'i-lucide-hard-drive', to: '/', exact: true },
        { label: 'Shared with me', icon: 'i-lucide-users', to: '/shared' },
        { label: 'Trash', icon: 'i-lucide-trash-2', to: '/trash' },
    ]);

    //------------------------------------------------------------------------------------------------------------------
    // New menu -- creation targets the open folder, so off a drive surface (shared/trash/search/account/admin) we drop
    // to My Files first and create there. The drive view owns the dialogs; this only raises the request.
    //------------------------------------------------------------------------------------------------------------------

    const onDriveRoute = computed(() => route.name === 'drive' || route.name === 'folder');

    async function requestCreate(kind : NewItemKind) : Promise<void>
    {
        if(!onDriveRoute.value) { await router.push('/'); }
        newItem.requestNew(kind);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Upload -- the picker lands files in the open folder, so off a drive surface we drop to My Files first, then open
    // the OS file dialog. The change handler enqueues against whichever folder is current by then and resets the input
    // so re-picking the same file fires again.
    //------------------------------------------------------------------------------------------------------------------

    const fileInput = ref<HTMLInputElement | null>(null);

    async function triggerUpload() : Promise<void>
    {
        if(!onDriveRoute.value) { await router.push('/'); }
        fileInput.value?.click();
    }

    function onFilesPicked(event : Event) : void
    {
        const input = event.target as HTMLInputElement;
        const files = input.files === null ? [] : Array.from(input.files);

        if(files.length > 0) { uploads.enqueue(files, drive.folderID); }

        input.value = '';
    }

    const newMenuItems = computed<DropdownMenuItem[][]>(() => [
        [
            { label: 'New folder', icon: 'i-lucide-folder-plus', onSelect: () => { void requestCreate('folder'); } },
            { label: 'Upload files', icon: 'i-lucide-upload', onSelect: () => { void triggerUpload(); } },
        ],
        [
            {
                label: 'New Markdown file',
                icon: 'i-lucide-file-text',
                onSelect: () => { void requestCreate('markdown'); },
            },
            { label: 'New text file', icon: 'i-lucide-file', onSelect: () => { void requestCreate('text'); } },
        ],
    ]);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
