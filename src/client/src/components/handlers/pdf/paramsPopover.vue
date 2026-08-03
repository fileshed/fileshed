<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Annotation Params
  --
  -- The parameter panel behind the active tool's caret: the colors, thicknesses, sizes, and toggles pdf.js exposes for
  -- the armed annotation editor. It shows only the controls that belong to the current mode -- highlight (color,
  -- thickness, show-all), text (color, size), or ink (color, thickness, opacity) -- and writes each change into the
  -- annotator store, which the render surface forwards to pdf.js. `none` has no params and renders nothing.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-4 p-3">
        <template v-if="mode === 'highlight'">
            <section class="flex flex-col gap-2">
                <p class="text-xs font-medium text-muted">
                    Color
                </p>
                <div class="flex gap-2">
                    <button
                        v-for="swatch in highlightColors"
                        :key="swatch.value"
                        type="button"
                        :aria-label="swatch.name"
                        :aria-pressed="store.editorParams.highlight.color === swatch.value"
                        class="size-6 rounded-full ring-offset-2 ring-offset-default transition"
                        :class="store.editorParams.highlight.color === swatch.value ? 'ring-2 ring-inverted' : ''"
                        :style="{ backgroundColor: swatch.value }"
                        @click="store.updateHighlight({ color: swatch.value })"
                    />
                </div>
            </section>

            <section class="flex flex-col gap-1">
                <p class="text-xs font-medium text-muted">
                    Thickness
                </p>
                <USlider
                    :model-value="store.editorParams.highlight.thickness"
                    :min="highlightThicknessRange.min"
                    :max="highlightThicknessRange.max"
                    :step="highlightThicknessRange.step"
                    size="sm"
                    @update:model-value="onSlide($event, (v) => store.updateHighlight({ thickness: v }))"
                />
            </section>

            <div class="flex items-center justify-between">
                <p class="text-sm text-default">
                    Show all
                </p>
                <USwitch
                    :model-value="store.editorParams.highlight.showAll"
                    size="sm"
                    @update:model-value="store.updateHighlight({ showAll: $event })"
                />
            </div>
        </template>

        <template v-else-if="mode === 'freetext'">
            <section class="flex flex-col gap-2">
                <p class="text-xs font-medium text-muted">
                    Color
                </p>
                <div class="flex gap-2">
                    <button
                        v-for="swatch in drawColors"
                        :key="swatch.value"
                        type="button"
                        :aria-label="swatch.name"
                        :aria-pressed="store.editorParams.text.color === swatch.value"
                        class="size-6 rounded-full ring-offset-2 ring-offset-default transition"
                        :class="store.editorParams.text.color === swatch.value ? 'ring-2 ring-inverted' : ''"
                        :style="{ backgroundColor: swatch.value }"
                        @click="store.updateText({ color: swatch.value })"
                    />
                </div>
            </section>

            <section class="flex flex-col gap-1">
                <p class="text-xs font-medium text-muted">
                    Size
                </p>
                <USlider
                    :model-value="store.editorParams.text.size"
                    :min="textSizeRange.min"
                    :max="textSizeRange.max"
                    :step="textSizeRange.step"
                    size="sm"
                    @update:model-value="onSlide($event, (v) => store.updateText({ size: v }))"
                />
            </section>
        </template>

        <template v-else-if="mode === 'ink'">
            <section class="flex flex-col gap-2">
                <p class="text-xs font-medium text-muted">
                    Color
                </p>
                <div class="flex gap-2">
                    <button
                        v-for="swatch in drawColors"
                        :key="swatch.value"
                        type="button"
                        :aria-label="swatch.name"
                        :aria-pressed="store.editorParams.ink.color === swatch.value"
                        class="size-6 rounded-full ring-offset-2 ring-offset-default transition"
                        :class="store.editorParams.ink.color === swatch.value ? 'ring-2 ring-inverted' : ''"
                        :style="{ backgroundColor: swatch.value }"
                        @click="store.updateInk({ color: swatch.value })"
                    />
                </div>
            </section>

            <section class="flex flex-col gap-1">
                <p class="text-xs font-medium text-muted">
                    Thickness
                </p>
                <USlider
                    :model-value="store.editorParams.ink.thickness"
                    :min="inkThicknessRange.min"
                    :max="inkThicknessRange.max"
                    :step="inkThicknessRange.step"
                    size="sm"
                    @update:model-value="onSlide($event, (v) => store.updateInk({ thickness: v }))"
                />
            </section>

            <section class="flex flex-col gap-1">
                <p class="text-xs font-medium text-muted">
                    Opacity
                </p>
                <USlider
                    :model-value="store.editorParams.ink.opacity"
                    :min="inkOpacityRange.min"
                    :max="inkOpacityRange.max"
                    :step="inkOpacityRange.step"
                    size="sm"
                    @update:model-value="onSlide($event, (v) => store.updateInk({ opacity: v }))"
                />
            </section>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import {
        type AnnotationMode,
        drawColors,
        highlightColors,
        highlightThicknessRange,
        inkOpacityRange,
        inkThicknessRange,
        textSizeRange,
    } from './types.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfParamsPopover' });

    defineProps<{
        mode : AnnotationMode;
    }>();

    const store = usePdfAnnotatorStore();

    //------------------------------------------------------------------------------------------------------------------

    // USlider yields number | number[] | undefined; every slider here is single-valued, so narrow to the one number
    // before handing it to the store setter.
    function onSlide(value : number | number[] | undefined, apply : (value : number) => void) : void
    {
        const next = Array.isArray(value) ? value[0] : value;
        if(typeof next === 'number') { apply(next); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
