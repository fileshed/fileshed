<!----------------------------------------------------------------------------------------------------------------------
  -- Account Page
  --
  -- The signed-in user's account surface, organized into sections: profile summary, general preferences (files-root
  -- name, time format), editor preferences (colorscheme, line numbers), and a storage summary. A thin composition --
  -- each control owns its own data off the session profile; the page only groups them under section headings.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="mx-auto flex max-w-2xl flex-col gap-8">
        <h1 class="text-2xl font-bold">
            Account
        </h1>

        <div class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Profile
            </h2>
            <AccountProfile />
        </div>

        <div class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Preferences
            </h2>
            <FilesRootName />
            <TimeFormat />
        </div>

        <div class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Editor
            </h2>
            <EditorColorScheme />
            <EditorGutter />
        </div>

        <div class="flex flex-col gap-3">
            <h2 class="text-lg font-semibold text-highlighted">
                Storage
            </h2>
            <AccountStorage />
        </div>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Components
    import AccountProfile from '../components/account/accountProfile.vue';
    import FilesRootName from '../components/account/filesRootName.vue';
    import TimeFormat from '../components/account/timeFormat.vue';
    import EditorColorScheme from '../components/account/editorColorScheme.vue';
    import EditorGutter from '../components/account/editorGutter.vue';
    import AccountStorage from '../components/account/accountStorage.vue';
</script>

<!--------------------------------------------------------------------------------------------------------------------->
