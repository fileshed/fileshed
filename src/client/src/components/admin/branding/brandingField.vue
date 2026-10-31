<!----------------------------------------------------------------------------------------------------------------------
  -- Branding Field
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-medium text-default">
                {{ title }}
            </h3>
            <slot name="meta" />
            <slot name="action">
                <UButton
                    v-if="resettable"
                    label="Use default"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-undo-2"
                    class="ms-auto"
                    @click="emit('reset')"
                />
            </slot>
        </div>

        <slot />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    defineProps<{
        title : string;
        resettable ?: boolean;
    }>();

    const emit = defineEmits<{ reset : [] }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
