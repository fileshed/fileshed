<!----------------------------------------------------------------------------------------------------------------------
  -- Reveal Token Modal
  --
  -- The one-time reveal: the only place a minted token's value ever exists client-side. Deliberately not dismissible
  -- by overlay or escape -- a stray click must not eat a secret that cannot be shown again -- so the only way out is
  -- Done, and closing clears the value from the modal's state.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal
        :open="isOpen"
        :dismissible="false"
        title="Copy your token now"
        description="This is the only time it will be shown. It is stored hashed, so it cannot be recovered — only
            revoked and re-created."
    >
        <template #body>
            <div class="flex items-center gap-2">
                <code
                    class="min-w-0 flex-1 break-all rounded-md border border-default bg-elevated px-3 py-2
                        font-mono text-sm select-all"
                    data-testid="minted-token"
                >{{ token }}</code>
                <UButton
                    :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                    :label="copied ? 'Copied' : 'Copy'"
                    color="neutral"
                    variant="subtle"
                    @click="copy"
                />
            </div>
        </template>

        <template #footer>
            <div class="flex w-full justify-end">
                <UButton label="Done" color="neutral" variant="ghost" @click="close" />
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    // Utils
    import { copyToClipboard } from '../../../../utils/copyToClipboard.ts';

    //------------------------------------------------------------------------------------------------------------------

    const toast = useToast();

    const isOpen = ref(false);
    const token = ref('');
    const copied = ref(false);

    function open(value : string) : void
    {
        token.value = value;
        copied.value = false;
        isOpen.value = true;
    }

    async function copy() : Promise<void>
    {
        if(await copyToClipboard(token.value))
        {
            copied.value = true;
        }
        else
        {
            toast.add({
                title: 'Couldn\'t copy',
                description: 'Select the token and copy it by hand before hitting Done.',
                color: 'error',
            });
        }
    }

    function close() : void
    {
        isOpen.value = false;
        token.value = '';
        copied.value = false;
    }

    defineExpose({ open });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
