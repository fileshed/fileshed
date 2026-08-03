<!----------------------------------------------------------------------------------------------------------------------
  -- Search Box
  --
  -- The top bar's search field and the suggestions that drop out of it. Enter runs the full search page as it always
  -- has; the dropdown is a shortcut over it -- arrow keys walk the rows, Enter takes the highlighted one, Escape puts
  -- the dropdown away without disturbing what has been typed.
  --
  -- The store owns the debounce and the stale-response discard; this owns whether the dropdown is showing and which row
  -- is highlighted, which are the box's own business and nobody else's.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div ref="root" class="relative max-w-md flex-1">
        <UInput
            v-model="term"
            icon="i-lucide-search"
            placeholder="Search files…"
            class="w-full"
            name="search"
            autocomplete="off"
            role="combobox"
            :aria-expanded="open"
            @focus="reopen"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter="onEnter"
            @keydown.esc="dismiss"
        />

        <SearchSuggestions
            v-if="open"
            :nodes="suggestions.nodes"
            :locations="suggestions.locations"
            :root-label="session.rootLabel"
            :term="suggestions.term"
            :loading="suggestions.loading"
            :active-index="activeIndex"
            @pick="pick"
            @hover="(index) => activeIndex = index"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
    import { useRouter } from 'vue-router';

    import { MIN_SUGGEST_CHARS } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';
    import { useSuggestionsStore } from '../../stores/suggestions.ts';

    // Components
    import SearchSuggestions from './searchSuggestions.vue';

    // Engines
    import { intent } from '../../engines/intent/index.ts';

    // Utils
    import { useOpenNode } from '../../utils/openNode.ts';

    //------------------------------------------------------------------------------------------------------------------

    const router = useRouter();
    const session = useSessionStore();
    const suggestions = useSuggestionsStore();
    const { perform } = useOpenNode();

    const root = ref<HTMLElement | null>(null);
    const term = ref('');
    const open = ref(false);
    const activeIndex = ref(-1);

    // The rows the arrow keys walk: one per suggestion, plus the "See all results" row that always closes the list.
    const rowCount = computed(() => suggestions.nodes.length + 1);

    const suggestible = computed(() => term.value.trim().length >= MIN_SUGGEST_CHARS);

    //------------------------------------------------------------------------------------------------------------------

    watch(term, (value) =>
    {
        suggestions.suggest(value);
        activeIndex.value = -1;
        open.value = suggestible.value;
    });

    function dismiss() : void
    {
        open.value = false;
        activeIndex.value = -1;
    }

    function reopen() : void
    {
        if(suggestible.value) { open.value = true; }
    }

    // Nothing is highlighted until an arrow key says so, which is what leaves a bare Enter meaning "run the search"
    // rather than "open whatever happened to come back first".
    function move(delta : number) : void
    {
        if(!open.value) { return; }

        const count = rowCount.value;
        if(activeIndex.value < 0) { activeIndex.value = delta > 0 ? 0 : count - 1; }
        else { activeIndex.value = (activeIndex.value + delta + count) % count; }
    }

    async function submitSearch() : Promise<void>
    {
        const query = term.value.trim();
        if(query.length === 0) { return; }

        dismiss();
        await router.push({ path: '/search', query: { q: query } });
    }

    // Anything past the last suggestion is the "See all results" row.
    function pick(index : number) : void
    {
        const node = suggestions.nodes[index];
        if(node === undefined)
        {
            void submitSearch();
            return;
        }

        dismiss();
        perform(intent.handlers.resolveOpen(node));
    }

    function onEnter() : void
    {
        if(open.value && activeIndex.value >= 0) { pick(activeIndex.value); }
        else { void submitSearch(); }
    }

    //------------------------------------------------------------------------------------------------------------------

    function onDocumentMouseDown(event : MouseEvent) : void
    {
        const target = event.target;
        if(target instanceof Node && root.value?.contains(target) === true) { return; }

        dismiss();
    }

    onMounted(() => document.addEventListener('mousedown', onDocumentMouseDown));

    onUnmounted(() =>
    {
        document.removeEventListener('mousedown', onDocumentMouseDown);
        suggestions.clear();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
