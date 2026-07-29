<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Branding Tab
  --
  -- The instance's look, live: every knob edits a draft that repaints this very page through preview variables,
  -- and nothing becomes real for anyone else until Save. No restart banner belongs here -- the whole surface
  -- applies on the next page load by design. Identity (the instance name) is an ordinary per-field setting; the
  -- visual knobs share the one draft/save bar.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-6 pb-20">
        <UAlert
            v-if="branding.error || settings.error"
            color="error"
            variant="soft"
            title="Couldn't load the branding."
            :actions="[ { label: 'Retry', color: 'error', variant: 'soft', onClick: () => reload() } ]"
        />

        <template v-else>
            <Teleport defer to="#admin-header-actions">
                <UTooltip text="View only — your own setting returns when you leave this tab.">
                    <UFieldGroup>
                        <UButton
                            label="Light"
                            icon="i-lucide-sun"
                            :variant="previewMode === 'light' ? 'solid' : 'outline'"
                            :color="previewMode === 'light' ? 'primary' : 'neutral'"
                            @click="previewIn('light')"
                        />
                        <UButton
                            label="Dark"
                            icon="i-lucide-moon"
                            :variant="previewMode === 'dark' ? 'solid' : 'outline'"
                            :color="previewMode === 'dark' ? 'primary' : 'neutral'"
                            @click="previewIn('dark')"
                        />
                    </UFieldGroup>
                </UTooltip>
            </Teleport>

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Identity
                </h2>
                <SettingField
                    v-if="instanceNameEntry"
                    :entry="instanceNameEntry"
                    label="Instance name"
                    description="Shown in the sidebar, page titles, and outgoing email."
                />
                <LogoField />
            </section>

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Colors
                </h2>
                <BrandColorField
                    label="Primary color"
                    description="Buttons, links, focus rings — the brand color everything keys off."
                    token="primary"
                    :model-value="branding.draft.primary"
                    @update:model-value="branding.setKnob({ primary: $event })"
                />
                <BrandColorField
                    label="Secondary color"
                    description="The supporting accent."
                    token="secondary"
                    :model-value="branding.draft.secondary"
                    @update:model-value="branding.setKnob({ secondary: $event })"
                />
                <NeutralField
                    :model-value="branding.draft.neutral"
                    @update:model-value="branding.setKnob({ neutral: $event })"
                />
            </section>

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Shape & mode
                </h2>
                <RadiusField
                    :model-value="branding.draft.radius"
                    @update:model-value="branding.setKnob({ radius: $event })"
                />
                <ModeField
                    :mode="branding.draft.mode"
                    :forced-mode="branding.draft.forcedMode"
                    @update:mode="branding.setKnob({ mode: $event })"
                    @update:forced-mode="branding.setKnob({ forcedMode: $event })"
                />
            </section>

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Custom CSS
                </h2>
                <CustomCssField
                    :model-value="branding.draft.customCSS"
                    @update:model-value="branding.setKnob({ customCSS: $event })"
                />
            </section>

            <div
                v-if="branding.dirty"
                class="sticky bottom-0 -mx-1 flex items-center gap-3 rounded-lg border border-default
                    bg-default/95 p-3 backdrop-blur"
                data-testid="save-bar"
            >
                <p class="text-sm text-muted">
                    Changes preview live on this page. Save makes them real for everyone.
                </p>
                <div class="ms-auto flex gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        label="Revert"
                        :disabled="saving"
                        @click="branding.revert()"
                    />
                    <UButton label="Save" :loading="saving" @click="save" />
                </div>
            </div>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, ref } from 'vue';

    import type { ColorMode } from '@fileshed/core';

    // Stores
    import { useAdminBrandingStore } from '../../stores/adminBranding.ts';
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';
    import { useAppStore } from '../../stores/app.ts';
    import { useSessionStore } from '../../stores/session.ts';

    // Engines
    import { resolveColorMode, resolvesToDark } from '../../engines/colorMode.ts';

    // Components
    import SettingField from '../../components/admin/settingField.vue';
    import LogoField from '../../components/admin/branding/logoField.vue';
    import BrandColorField from '../../components/admin/branding/brandColorField.vue';
    import NeutralField from '../../components/admin/branding/neutralField.vue';
    import RadiusField from '../../components/admin/branding/radiusField.vue';
    import ModeField from '../../components/admin/branding/modeField.vue';
    import CustomCssField from '../../components/admin/branding/customCssField.vue';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const branding = useAdminBrandingStore();
    const settings = useAdminSettingsStore();
    const app = useAppStore();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const saving = ref(false);

    function reload() : Promise<unknown>
    {
        return Promise.all([ branding.load(), settings.load() ]);
    }

    onMounted(() => { void reload(); });

    // Leaving the tab must not leave a half-tuned draft painted over the rest of the app -- nor the preview
    // mode: the admin's own resolved setting comes back.
    onUnmounted(() =>
    {
        branding.revert();

        const resolved = resolveColorMode(app.branding, session.colorMode);
        const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
        document.documentElement.classList.toggle('dark', resolvesToDark(resolved, systemPrefersDark));
    });

    //------------------------------------------------------------------------------------------------------------------
    // Mode preview
    //------------------------------------------------------------------------------------------------------------------

    // View-only, literally: the preview flips the dark class directly and never touches the color-mode store,
    // so nothing persists -- a reload mid-preview comes back in the admin's own mode.
    const previewMode = ref<ColorMode>(document.documentElement.classList.contains('dark') ? 'dark' : 'light');

    function previewIn(mode : ColorMode) : void
    {
        previewMode.value = mode;
        document.documentElement.classList.toggle('dark', mode === 'dark');
    }

    const instanceNameEntry = computed(() =>
        settings.entries.find((entry) => entry.key === 'INSTANCE_NAME'));

    function save() : void
    {
        void runMutation(() => branding.save(), saving);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
