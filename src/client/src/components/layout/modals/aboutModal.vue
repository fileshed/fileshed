<!----------------------------------------------------------------------------------------------------------------------
  -- About Modal
  --
  -- What this instance is, and where to take a problem with it. The commit is the one fact a bug report needs and the
  -- one nobody can retype from memory, so it carries a copy rather than asking to be read off the screen. The build
  -- facts are fetched when the dialog opens instead of on every mount of the menu that holds it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="About">
        <template #body>
            <div class="flex flex-col gap-6">
                <div class="flex items-center gap-3">
                    <img :src="app.logoUrl" alt="" class="size-10 rounded">
                    <div class="flex flex-col">
                        <span class="text-base font-semibold text-highlighted">{{ app.name }}</span>
                        <span class="text-sm text-muted">{{ app.tagline }}</span>
                    </div>
                </div>

                <dl v-if="build !== null" class="flex flex-col gap-3 rounded-lg border border-default p-4">
                    <div class="flex items-center gap-3">
                        <dt class="w-20 shrink-0 text-xs text-muted">
                            Version
                        </dt>
                        <dd class="text-sm font-medium">
                            {{ build.version }}
                        </dd>
                    </div>

                    <div v-if="build.commit !== null" class="flex items-center gap-3">
                        <dt class="w-20 shrink-0 text-xs text-muted">
                            Commit
                        </dt>
                        <dd class="flex items-center gap-1.5">
                            <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">{{ build.commit }}</code>
                            <UButton
                                icon="i-lucide-copy"
                                color="neutral"
                                variant="ghost"
                                size="xs"
                                aria-label="Copy the commit"
                                @click="copyCommit"
                            />
                        </dd>
                    </div>

                    <div v-if="build.branch !== null" class="flex items-center gap-3">
                        <dt class="w-20 shrink-0 text-xs text-muted">
                            Branch
                        </dt>
                        <dd class="text-sm font-medium">
                            {{ build.branch }}
                        </dd>
                    </div>
                </dl>

                <p v-else class="text-sm text-muted">
                    Reading the version&hellip;
                </p>

                <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <a :href="ISSUES_URL" target="_blank" rel="noopener" class="text-primary hover:underline">
                        Report a bug
                    </a>
                    <a :href="REPO_URL" target="_blank" rel="noopener" class="text-primary hover:underline">
                        Source code
                    </a>
                    <a
                        v-if="build !== null"
                        :href="releaseNotesUrl"
                        target="_blank"
                        rel="noopener"
                        class="text-primary hover:underline"
                    >Release notes</a>
                </div>

                <p class="text-xs text-dimmed">
                    Free software under the
                    <a :href="LICENSE_URL" target="_blank" rel="noopener" class="hover:underline">GNU AGPL v3</a>.
                </p>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import { ISSUES_URL, LICENSE_URL, RELEASE_NOTES_URL, REPO_URL } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../../../stores/app.ts';
    import { useSessionStore } from '../../../stores/session.ts';

    // Utils
    import { copyToClipboard } from '../../../utils/copyToClipboard.ts';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();
    const toast = useToast();

    const open = ref(false);

    const build = computed(() => session.build);
    const releaseNotesUrl = computed(() => `${ RELEASE_NOTES_URL }/v${ build.value?.version ?? '' }`);

    //------------------------------------------------------------------------------------------------------------------

    function show() : void
    {
        open.value = true;
        session.loadVersion().catch((error : unknown) => { console.error('Version lookup failed', error); });
    }

    // Copying can fail outright on a plain-HTTP LAN address, so the toast says which happened and shows the hash
    // either way -- a reader who has to retype it can at least read it from the toast.
    async function copyCommit() : Promise<void>
    {
        const commit = build.value?.commit ?? null;
        if(commit === null) { return; }

        const copied = await copyToClipboard(commit);

        toast.add(copied
            ? { title: 'Commit copied', description: commit, color: 'success' }
            : { title: 'Couldn\'t copy the commit', description: commit, color: 'error' });
    }

    defineExpose({ open: show });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
