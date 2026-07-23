<!----------------------------------------------------------------------------------------------------------------------
  -- Request Access
  --
  -- The requester's side of a share request, shown when a signed-in user opens a node they cannot resolve: the item is
  -- either shared with someone else or gone, and the server does not leak which. It offers to ask the target's owner for
  -- access at a chosen role, and on success shows the pending state. The server is the authority on legality -- an
  -- already-held grant, an existing pending request, or a vanished node all come back as typed errors surfaced inline
  -- here, rather than the client pre-guessing an outcome it cannot know.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <template v-if="pending">
            <UIcon name="i-lucide-clock" class="size-10 text-primary" />
            <div>
                <p class="font-medium">
                    Access requested
                </p>
                <p class="mt-1 text-sm text-muted">
                    The owner will decide whether to grant you {{ pending.requestedRole }} access.
                </p>
            </div>
            <UButton icon="i-lucide-arrow-left" label="Back to files" color="neutral" @click="emit('back')" />
        </template>

        <template v-else>
            <UIcon name="i-lucide-lock" class="size-10 text-dimmed" />
            <div>
                <p class="font-medium">
                    You don't have access to this item
                </p>
                <p class="mt-1 text-sm text-muted">
                    Ask the owner to share it with you.
                </p>
            </div>

            <div class="flex items-center gap-2">
                <USelect v-model="role" :items="roleItems" size="sm" class="w-32" :disabled="submitting" />
                <UButton
                    icon="i-lucide-user-plus"
                    label="Request access"
                    :loading="submitting"
                    @click="submit"
                />
            </div>

            <div class="w-full max-w-sm text-left">
                <UTextarea
                    v-model="message"
                    :maxlength="ACCESS_REQUEST_MESSAGE_MAX_CHARS"
                    :rows="2"
                    placeholder="Add a message for the owner (optional)"
                    class="w-full"
                    :disabled="submitting"
                />
                <p class="mt-1 text-right text-xs text-muted">
                    {{ message.length }} / {{ ACCESS_REQUEST_MESSAGE_MAX_CHARS }}
                </p>
            </div>

            <p v-if="errorMessage" class="text-sm text-error">
                {{ errorMessage }}
            </p>

            <UButton
                icon="i-lucide-arrow-left"
                label="Back to files"
                color="neutral"
                variant="ghost"
                @click="emit('back')"
            />
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    import {
        ACCESS_REQUEST_MESSAGE_MAX_CHARS,
        type AccessRequestResponse,
        type ShareRole,
        shareRoles,
    } from '@fileshed/core';

    // Resource Access
    import { ApiError } from '../../resource-access/apiError.ts';
    import { requestAccess } from '../../resource-access/accessRequests.ts';

    // Utils
    import { describeApiError } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodeID : string;
    }>();

    const emit = defineEmits<{
        back : [];
    }>();

    const role = ref<ShareRole>('viewer');
    const message = ref('');
    const submitting = ref(false);
    const pending = ref<AccessRequestResponse | null>(null);
    const errorMessage = ref<string | null>(null);

    const roleItems = shareRoles.map((value) => ({
        label: `${ value[0]?.toUpperCase() ?? '' }${ value.slice(1) }`,
        value,
    }));

    //------------------------------------------------------------------------------------------------------------------

    async function submit() : Promise<void>
    {
        submitting.value = true;
        errorMessage.value = null;

        try
        {
            const trimmed = message.value.trim();
            pending.value = await requestAccess(props.nodeID, {
                requestedRole: role.value,
                ...(trimmed === '' ? {} : { message: trimmed }),
            });
        }
        catch(caught)
        {
            // A 404 is the server's non-leaking answer for a node that is gone (or never was); anything else -- an
            // already-held grant, an existing pending request -- carries its own message worth showing verbatim.
            errorMessage.value = caught instanceof ApiError && caught.status === 404
                ? 'This item no longer exists.'
                : describeApiError(caught);
        }
        finally
        {
            submitting.value = false;
        }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
