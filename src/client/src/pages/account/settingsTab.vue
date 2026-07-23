<!----------------------------------------------------------------------------------------------------------------------
  -- Settings Tab
  --
  -- The account area's preferences tab: the general preferences (files-root name, time format) and the editor
  -- preferences (colorscheme, line numbers). Each control owns its own data off the session profile; the tab only
  -- groups them under section headings.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-8">
        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Preferences
            </h2>
            <FilesRootName />
            <TimeFormat />
        </section>

        <section class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Editor
            </h2>
            <EditorColorScheme />
            <EditorGutter />
        </section>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import FilesRootName from '../../components/account/filesRootName.vue';
    import TimeFormat from '../../components/account/timeFormat.vue';
    import EditorColorScheme from '../../components/account/editorColorScheme.vue';
    import EditorGutter from '../../components/account/editorGutter.vue';
</script>

<!--------------------------------------------------------------------------------------------------------------------->
