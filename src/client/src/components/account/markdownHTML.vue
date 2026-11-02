<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown HTML
  --
  -- The account-page toggle for rendering HTML in markdown files someone else owns without the banner asking first.
  -- The owner's own files always render their HTML.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center justify-between gap-4 rounded-lg border border-default p-4">
        <div class="min-w-0">
            <h3 class="flex flex-wrap items-center gap-2 font-medium text-default">
                HTML in others' markdown
                <UBadge
                    label="Security"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                />
            </h3>
            <p class="mt-1 text-sm text-muted">
                A markdown file shared with you can contain HTML. It shows as source, with a banner to render it,
                because rendered HTML can be made to look like part of FileShed itself. Turned on, it renders straight
                away. Scripts are always removed.
            </p>
        </div>

        <USwitch
            :model-value="session.showMarkdownHTML"
            :disabled="pending"
            @update:model-value="choose"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    function choose(shown : boolean) : void
    {
        void runMutation(() => session.savePreferences({ showMarkdownHTML: shown }), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
