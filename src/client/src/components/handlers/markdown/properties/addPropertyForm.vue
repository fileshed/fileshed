<!----------------------------------------------------------------------------------------------------------------------
  -- Add Property Form
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-1">
        <form class="flex items-center gap-2" @submit.prevent="onAdd">
            <UInput v-model="key" placeholder="New property" aria-label="Property name" size="sm" class="min-w-0 flex-1" />
            <USelect v-model="kind" :items="kindItems" aria-label="Property type" size="sm" class="w-32" />
            <UButton
                type="submit"
                icon="i-lucide-plus"
                label="Add"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="!valid"
            />
        </form>
        <p v-if="taken" class="text-xs text-error">
            There's already a property named “{{ trimmed }}”.
        </p>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    // Engines
    import {
        type PropertyKind,
        type PropertyValue,
        initialPropertyValue,
    } from '../../../../engines/markdown/properties.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownAddPropertyForm' });

    const props = defineProps<{
        keys : string[];
    }>();

    const emit = defineEmits<{
        add : [ key : string, value : PropertyValue ];
    }>();

    const kindItems : { label : string; value : PropertyKind; icon : string }[] = [
        { label: 'Text', value: 'text', icon: 'i-lucide-text' },
        { label: 'Number', value: 'number', icon: 'i-lucide-hash' },
        { label: 'Checkbox', value: 'checkbox', icon: 'i-lucide-square-check' },
        { label: 'Date', value: 'date', icon: 'i-lucide-calendar' },
        { label: 'List', value: 'list', icon: 'i-lucide-list' },
    ];

    const key = ref('');
    const kind = ref<PropertyKind>('text');

    const trimmed = computed(() => key.value.trim());
    const taken = computed(() => props.keys.includes(trimmed.value));
    const valid = computed(() => trimmed.value !== '' && !taken.value);

    function onAdd() : void
    {
        if(!valid.value) { return; }

        emit('add', trimmed.value, initialPropertyValue(kind.value, new Date()));
        key.value = '';
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
