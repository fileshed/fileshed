<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Identity Bar
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <EditorHeaderSlot>
        <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-file-pen" class="shrink-0 text-dimmed" />
            <span v-if="title !== null && store.readOnly" class="truncate font-medium" :title="fileName">
                {{ title }}
            </span>
            <RenameTitle
                v-else-if="title !== null"
                :name="title"
                :read-only="false"
                :rename="frontmatter.setTitle"
                :tooltip="fileName"
                input-label="Title"
                include-extension
            />
            <RenameTitle v-else :name="fileName" :read-only="store.readOnly" :rename="store.rename" />
            <SharingBadges :sharing="store.node?.sharing ?? null" />
            <FileActionsMenu
                v-if="store.node !== null"
                :node-i-d="store.node.id"
                :name="fileName"
                :read-only="store.readOnly"
                :rename="store.rename"
                :items="propertiesItems"
            />
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-3">
            <SaveIndicator
                :saving="store.saving"
                :dirty="store.dirty"
                :last-saved="store.lastSaved"
                :save-error="store.saveError"
                @retry="store.save()"
            />

            <!-- Icon-only until the header has room for the labels. -->
            <UFieldGroup>
                <UTooltip text="Preview">
                    <UButton
                        :variant="view === 'wysiwyg' ? 'solid' : 'outline'"
                        color="neutral"
                        size="sm"
                        icon="i-lucide-eye"
                        label="Preview"
                        aria-label="Preview"
                        :ui="{ label: 'hidden xl:inline' }"
                        @click="emit('update:view', 'wysiwyg')"
                    />
                </UTooltip>
                <UTooltip text="Source">
                    <UButton
                        :variant="view === 'source' ? 'solid' : 'outline'"
                        color="neutral"
                        size="sm"
                        icon="i-lucide-code"
                        label="Source"
                        aria-label="Source"
                        :ui="{ label: 'hidden xl:inline' }"
                        @click="emit('update:view', 'source')"
                    />
                </UTooltip>
            </UFieldGroup>

            <UBadge v-if="store.readOnly" color="neutral" variant="subtle" label="Read only" icon="i-lucide-eye" />
        </div>
    </EditorHeaderSlot>

    <EditPropertiesModal ref="propertiesModal" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onUnmounted, useTemplateRef, watchEffect } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../../../stores/app.ts';
    import { useEditorStore } from '../../../stores/editor.ts';
    import { useFrontmatterStore } from '../../../stores/frontmatter.ts';

    // Components
    import EditPropertiesModal from './modals/editPropertiesModal.vue';
    import EditorHeaderSlot from '../editorHeaderSlot.vue';
    import FileActionsMenu from '../fileActionsMenu.vue';
    import SharingBadges from '../../share/sharingBadges.vue';
    import RenameTitle from '../renameTitle.vue';
    import SaveIndicator from '../saveIndicator.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownIdentityBar' });

    defineProps<{
        view : 'wysiwyg' | 'source';
    }>();

    const emit = defineEmits<{
        'update:view' : [ view : 'wysiwyg' | 'source' ];
    }>();

    const app = useAppStore();
    const store = useEditorStore();
    const frontmatter = useFrontmatterStore();

    const propertiesModal = useTemplateRef<InstanceType<typeof EditPropertiesModal>>('propertiesModal');

    const fileName = computed(() => store.node?.name ?? 'Untitled');
    const title = computed(() => frontmatter.meta.title);

    const propertiesItems = computed<DropdownMenuItem[]>(() =>
    {
        const { state } = frontmatter;
        const onSelect = () : void => { propertiesModal.value?.open(); };
        const label = store.readOnly ? 'View properties' : 'Edit properties';

        if(state.kind === 'raw') { return [ { label, icon: 'i-lucide-triangle-alert', color: 'warning', onSelect } ]; }
        if(state.kind === 'properties') { return [ { label, icon: 'i-lucide-list', onSelect } ]; }

        return store.readOnly ? [] : [ { label: 'Add properties', icon: 'i-lucide-plus', onSelect } ];
    });

    watchEffect(() => { app.setPageTitle(title.value); });
    onUnmounted(() => { app.setPageTitle(null); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
