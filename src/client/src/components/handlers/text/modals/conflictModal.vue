<!----------------------------------------------------------------------------------------------------------------------
  -- Conflict Modal
  --
  -- Shown when a save is refused because the file changed under the editor -- someone else saved first. It offers the
  -- two resolutions and nothing else: Reload discards local edits for the server's current version, Overwrite replaces
  -- that version with the local buffer. The parent owns both actions (they live on the editor store); this only emits
  -- the choice and stays open while an overwrite is in flight.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="This file changed elsewhere" :dismissible="!busy">
        <template #body>
            <div class="space-y-4">
                <p class="text-sm text-muted">
                    Someone else saved a new version of this file while you were editing. Reload to discard your changes
                    and take their version, or overwrite to replace it with yours.
                </p>

                <div class="flex justify-end gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        label="Reload"
                        :disabled="busy"
                        @click="emit('reload')"
                    />
                    <UButton
                        color="error"
                        icon="i-lucide-triangle-alert"
                        label="Overwrite"
                        :loading="busy"
                        @click="emit('overwrite')"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    withDefaults(defineProps<{ busy ?: boolean }>(), { busy: false });

    const open = defineModel<boolean>('open', { required: true });

    const emit = defineEmits<{
        reload : [];
        overwrite : [];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
