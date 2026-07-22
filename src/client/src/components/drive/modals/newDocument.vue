<!----------------------------------------------------------------------------------------------------------------------
  -- New Document Modal
  --
  -- The New Markdown / New text prompt, self-subscribed to the sidebar's create signal. It defaults to an extensioned
  -- name and enforces that extension on whatever the user types, then creates an empty file in the open folder. Stays
  -- open until the create resolves, so a rejection can toast without the dialog vanishing under it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NameDialog
        v-model:open="open"
        :title="config.title"
        label="Name"
        submit-label="Create"
        :initial="config.initial"
        :pending="pending"
        @submit="onSubmit"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import { useRouter } from 'vue-router';

    // Stores
    import { useDriveStore } from '../../../stores/drive.ts';
    import { useNewItemStore } from '../../../stores/newItem.ts';

    // Components
    import NameDialog from '../nameDialog.vue';

    // Utils
    import { ensureExtension } from '../../../utils/formatters/index.ts';
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    type DocumentKind = 'markdown' | 'text';

    const DOC_CONFIG = {
        markdown: { title: 'New Markdown file', initial: 'Untitled.md', extension: '.md', mimeType: 'text/markdown' },
        text: { title: 'New text file', initial: 'Untitled.txt', extension: '.txt', mimeType: 'text/plain' },
    } as const;

    const store = useDriveStore();
    const newItem = useNewItemStore();
    const router = useRouter();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const kind = ref<DocumentKind>('markdown');
    const config = computed(() => DOC_CONFIG[kind.value]);

    // A markdown or text request is ours; a folder request is left untouched for the folder modal to consume.
    watch(() => newItem.request, (request) =>
    {
        if(request?.kind !== 'markdown' && request?.kind !== 'text') { return; }

        newItem.consume();
        kind.value = request.kind;
        open.value = true;
    }, { immediate: true });

    // Create the empty file, then drop straight into the editor for it -- a new document opens ready to type in.
    function onSubmit(name : string) : void
    {
        const { extension, mimeType } = config.value;
        let createdID : string | null = null;

        void runMutation(
            async () => { createdID = (await store.createEmptyFile(ensureExtension(name, extension), mimeType)).id; },
            pending,
            () =>
            {
                open.value = false;
                if(createdID !== null) { void router.push(`/file/${ createdID }`); }
            }
        );
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
