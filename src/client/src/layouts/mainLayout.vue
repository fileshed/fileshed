<!----------------------------------------------------------------------------------------------------------------------
  -- Main Layout
  --
  -- The primary authenticated chrome: the drive sidebar over the shared app shell. Auth pages render outside this
  -- layout (sibling routes), so it can assume a signed-in user.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <AppShell>
        <template #sidebar>
            <RouterLink to="/" class="mb-6 flex items-center gap-2 px-2 text-xl font-bold">
                <img :src="app.logoUrl" alt="" class="size-8">
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
        </template>

        <RouterView />

        <template #overlays>
            <input ref="fileInput" type="file" multiple class="hidden" @change="onFilesPicked">
            <input ref="folderInput" type="file" webkitdirectory class="hidden" @change="onFolderPicked">

            <UploadPanel />
            <UploadCollision />
        </template>
    </AppShell>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
    import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui';

    // Engines
    import { payloadFromRelativePaths } from '../engines/uploads/droppedTree.ts';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';
    import { type NewItemKind, useNewItemStore } from '../stores/newItem.ts';
    import { useDriveStore } from '../stores/drive.ts';
    import { useUploadsStore } from '../stores/uploads.ts';

    // Components
    import AppShell from '../components/layout/appShell.vue';
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
    const folderInput = ref<HTMLInputElement | null>(null);

    async function triggerUpload() : Promise<void>
    {
        if(!onDriveRoute.value) { await router.push('/'); }
        fileInput.value?.click();
    }

    async function triggerFolderUpload() : Promise<void>
    {
        if(!onDriveRoute.value) { await router.push('/'); }
        folderInput.value?.click();
    }

    function onFilesPicked(event : Event) : void
    {
        const input = event.target as HTMLInputElement;
        const files = input.files === null ? [] : Array.from(input.files);

        if(files.length > 0) { uploads.enqueue(files, drive.folderID); }

        input.value = '';
    }

    // A directory pick arrives as a flat file list whose webkitRelativePath spells out the tree; the uploads store
    // rebuilds and creates the folders before the files start.
    function onFolderPicked(event : Event) : void
    {
        const input = event.target as HTMLInputElement;
        const files = input.files === null ? [] : Array.from(input.files);

        if(files.length > 0) { void uploads.enqueuePayload(payloadFromRelativePaths(files), drive.folderID); }

        input.value = '';
    }

    const newMenuItems = computed<DropdownMenuItem[][]>(() => [
        [
            { label: 'New folder', icon: 'i-lucide-folder-plus', onSelect: () => { void requestCreate('folder'); } },
            { label: 'Upload files', icon: 'i-lucide-upload', onSelect: () => { void triggerUpload(); } },
            {
                label: 'Upload folder',
                icon: 'i-lucide-folder-up',
                onSelect: () => { void triggerFolderUpload(); },
            },
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
