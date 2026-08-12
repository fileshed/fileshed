<!----------------------------------------------------------------------------------------------------------------------
  -- Share Dialog
  --
  -- The share surface for one node, opened imperatively by the drive page. Composes two self-contained sections: People
  -- (user-to-user grants) always, and Get link (public links) for files only -- a folder carries no bytes to serve.
  -- Each section owns its own load, pending state, and mutations; this dialog only holds visibility and the target,
  -- hands the owner summary (the caller, since sharing is owner-only) to the People section, and relays either
  -- section's change up under the node it happened to.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title">
        <template #body>
            <div v-if="node" class="flex flex-col gap-6">
                <PeopleSection :node="node" :owner="owner" @changed="announceChange" />
                <LinkSection v-if="node.type === 'file'" :node="node" @changed="announceChange" />
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import type { NodeResponse, UserSummary } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../../stores/session.ts';

    // Components
    import PeopleSection from '../peopleSection.vue';
    import LinkSection from '../linkSection.vue';

    //------------------------------------------------------------------------------------------------------------------

    // Either section changing what the node exposes, named by node id so the surface behind the dialog can re-read
    // that one node's badges and menu without waiting for the dialog to close.
    const emit = defineEmits<{
        changed : [ nodeID : string ];
    }>();

    const session = useSessionStore();

    const open = ref(false);
    const node = ref<NodeResponse | null>(null);

    const title = computed(() =>
    {
        return node.value ? `Share "${ node.value.name }"` : 'Share';
    });

    // The caller's own summary, since the share dialog is owner-only -- so the owner row always renders with a real
    // name and avatar. name falls back to the email when the account carries none.
    const owner = computed<UserSummary | null>(() =>
    {
        const me = session.me;
        if(me === null) { return null; }

        return { id: me.id, name: me.name ?? me.email, email: me.email, image: me.image ?? null };
    });

    function announceChange() : void
    {
        if(node.value !== null) { emit('changed', node.value.id); }
    }

    function openFor(target : NodeResponse) : void
    {
        node.value = target;
        open.value = true;
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
