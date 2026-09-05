//----------------------------------------------------------------------------------------------------------------------
// Markdown Editor — the normalization policy and mode toggle
//
// The mount component's contract is that the buffer is written only on a real edit, never on a view, so a saved diff
// stays honest. UEditor can't drive under jsdom (its theme + component machinery are wired by the Nuxt UI Vite plugin,
// which tests don't load), so it is stubbed at the boundary: the stub captures the props the component hands it,
// exposes an editor whose setContent/getMarkdown/setEditable the component drives, and lets a test fire the
// update:modelValue edit signal. The child surfaces, the identity bar, and the conflict modal are stubbed to plain
// elements so the data flow is directly observable. What this guards: opening parses through the constructor without
// dirtying, a genuine edit emits the re-serialized markdown, toggling to Source shows the original when clean and the
// serialization when edited, Source edits write verbatim, an external reload re-parses (its own echo skipped),
// read-only reaches the editor, and formatting rides a fixed toolbar (hidden in Source and for viewers) beside a
// slimmed bubble toolbar and a slash menu.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable vue/one-component-per-file -- the UEditor family is stubbed at the boundary; three stubs live here */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { type Component, defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import MarkdownEditor from '@client/components/handlers/markdown/markdownEditor.vue';

//----------------------------------------------------------------------------------------------------------------------

interface SetContentCapture
{
    content : string;
    options : { contentType : string; emitUpdate : boolean };
}

// The UEditor boundary: the props the component handed it, the markdown its editor currently serializes to, and the
// setContent / setEditable calls the component drove through the exposed editor instance. Reset per test.
const ueditor = {
    modelValue: '',
    contentType: '',
    editable: true,
    image: true as boolean,
    mention: true as boolean,
    layout: '',
    markdown: '',
    setContentCalls: [] as SetContentCapture[],
    setEditableCalls: [] as boolean[],
    emit: undefined as ((event : string, value : string) => void) | undefined,
};

const editorInstance = {
    getMarkdown: () : string => ueditor.markdown,
    commands: {
        setContent: (content : string, options : { contentType : string; emitUpdate : boolean }) : void =>
        {
            ueditor.setContentCalls.push({ content, options });
        },
    },
    setEditable: (editable : boolean) : void => { ueditor.setEditableCalls.push(editable); },
};

const UEditorStub = defineComponent({
    name: 'UEditor',
    props: {
        modelValue: { type: String, default: '' },
        contentType: { type: String, default: '' },
        editable: { type: Boolean, default: true },
        image: { type: Boolean, default: true },
        mention: { type: Boolean, default: true },
        starterKit: { type: [ Boolean, Object ], default: undefined },
        extensions: { type: Array, default: () => [] },
        handlers: { type: Object, default: () => ({}) },
        placeholder: { type: String, default: '' },
        ui: { type: Object, default: () => ({}) },
    },
    emits: [ 'update:modelValue' ],
    setup(props, { emit, expose, slots })
    {
        ueditor.emit = emit;
        expose({ editor: editorInstance });

        return () =>
        {
            ueditor.modelValue = props.modelValue;
            ueditor.contentType = props.contentType;
            ueditor.editable = props.editable;
            ueditor.image = props.image;
            ueditor.mention = props.mention;

            return h('div', { class: 'ueditor' }, slots.default ? slots.default({ editor: editorInstance }) : []);
        };
    },
});

const UEditorToolbarStub = defineComponent({
    name: 'UEditorToolbar',
    props: {
        editor: { type: Object, default: null },
        items: { type: Array, default: () => [] },
        layout: { type: String, default: 'fixed' },
    },
    setup(props)
    {
        return () =>
        {
            ueditor.layout = props.layout;
            return h('div', { 'class': 'bubble-toolbar', 'data-layout': props.layout });
        };
    },
});

const UEditorSuggestionMenuStub = defineComponent({
    name: 'UEditorSuggestionMenu',
    props: {
        editor: { type: Object, default: null },
        items: { type: Array, default: () => [] },
    },
    setup()
    {
        return () => h('div', { class: 'slash-menu' });
    },
});

//----------------------------------------------------------------------------------------------------------------------

// The identity bar owns the Preview/Source toggle; it teleports into the layout header in the real component, so it is
// stubbed here to a plain in-flow element that fires the same update:view the editor listens for.
vi.mock('@client/components/handlers/markdown/identityBar.vue', () => ({
    default: {
        name: 'MarkdownIdentityBar',
        props: [ 'view' ],
        emits: [ 'update:view' ],
        template: '<div class="identity">'
            + '<button class="to-source" @click="$emit(\'update:view\', \'source\')" />'
            + '<button class="to-wysiwyg" @click="$emit(\'update:view\', \'wysiwyg\')" /></div>',
    },
}));

// The fixed formatting toolbar's own groups are covered by its own spec; here it is a marker that records that it was
// mounted (and handed the live editor) inside the WYSIWYG surface.
vi.mock('@client/components/handlers/markdown/toolbar.vue', () => ({
    default: {
        name: 'MarkdownFormatToolbar',
        props: [ 'editor' ],
        template: '<div class="format-toolbar" />',
    },
}));

vi.mock('@client/components/handlers/text/textEditor.vue', () => ({
    default: {
        name: 'TextEditor',
        props: [ 'modelValue', 'mode', 'readOnly', 'theme', 'gutter' ],
        emits: [ 'update:modelValue' ],
        template: '<textarea class="source" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
}));

vi.mock('@client/components/handlers/text/modals/conflictModal.vue', () => ({
    default: {
        name: 'ConflictModal',
        props: [ 'open', 'busy' ],
        emits: [ 'reload', 'overwrite', 'update:open' ],
        template: '<div v-if="open" class="conflict" />',
    },
}));

// The editor store's resource-access and toast seams -- the store is real, but nothing here drives a save over them.
vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeText: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    uploadTicket: vi.fn(),
    answerChallenge: vi.fn(),
}));
vi.mock('@client/engines/claim.ts', () => ({ computeProofAnswer: vi.fn() }));
vi.mock('@client/utils/hashFile.ts', () => ({ hashFile: vi.fn(), readSampleWindows: vi.fn() }));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const globalStubs : Record<string, Component> = {
    UEditor: UEditorStub,
    UEditorToolbar: UEditorToolbarStub,
    UEditorSuggestionMenu: UEditorSuggestionMenuStub,
};

function mountEditor(overrides : Record<string, unknown> = {}) : VueWrapper
{
    return mount(MarkdownEditor, {
        props: {
            modelValue: '# Hello',
            mode: 'markdown',
            readOnly: false,
            theme: 'ayu-dark',
            gutter: true,
            ...overrides,
        },
        global: { stubs: globalStubs },
    });
}

function sourceValue(wrapper : VueWrapper) : string
{
    return (wrapper.get('.source').element as HTMLTextAreaElement).value;
}

function lastEmit(wrapper : VueWrapper) : string | undefined
{
    const events = wrapper.emitted('update:modelValue');
    if(events === undefined) { return undefined; }

    return events[events.length - 1]?.[0] as string;
}

// Fire UEditor's update:modelValue, the signal the component treats as a genuine edit.
async function editInEditor(wrapper : VueWrapper, markdown : string) : Promise<void>
{
    ueditor.markdown = markdown;
    ueditor.emit?.('update:modelValue', markdown);
    await wrapper.vm.$nextTick();
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownEditor normalization policy', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        ueditor.modelValue = '';
        ueditor.contentType = '';
        ueditor.editable = true;
        ueditor.image = true;
        ueditor.mention = true;
        ueditor.layout = '';
        ueditor.markdown = '';
        ueditor.setContentCalls = [];
        ueditor.setEditableCalls = [];
        ueditor.emit = undefined;
    });

    it('parses the source through the constructor and leaves the buffer clean on open', () =>
    {
        const wrapper = mountEditor({ modelValue: '# Original' });

        expect(ueditor.modelValue).toBe('# Original');
        expect(ueditor.contentType).toBe('markdown');
        expect(ueditor.setContentCalls).toHaveLength(0);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('emits the re-serialized markdown on a genuine WYSIWYG edit', async () =>
    {
        const wrapper = mountEditor({ modelValue: '# Original' });

        await editInEditor(wrapper, '# Original normalized');

        expect(lastEmit(wrapper)).toBe('# Original normalized');
    });

    it('shows the untouched original in Source when the document was not edited in WYSIWYG', async () =>
    {
        const wrapper = mountEditor({ modelValue: '# Original' });

        await wrapper.get('.to-source').trigger('click');

        expect(sourceValue(wrapper)).toBe('# Original');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('shows the current serialization in Source after a WYSIWYG edit', async () =>
    {
        const wrapper = mountEditor({ modelValue: '# Original' });

        await editInEditor(wrapper, '# Normalized');
        // The host is controlled: it feeds the emitted value back as the buffer, as the store would.
        await wrapper.setProps({ modelValue: '# Normalized' });
        await wrapper.get('.to-source').trigger('click');

        expect(sourceValue(wrapper)).toBe('# Normalized');
    });

    it('writes Source-mode edits to the buffer verbatim', async () =>
    {
        const wrapper = mountEditor({ modelValue: '# Original' });

        await wrapper.get('.to-source').trigger('click');
        await wrapper.get('.source').setValue('raw *verbatim* source  ');

        expect(lastEmit(wrapper)).toBe('raw *verbatim* source  ');
    });

    it('re-parses the buffer without dirtying it when toggling back to WYSIWYG', async () =>
    {
        const wrapper = mountEditor({ modelValue: '# Original' });

        await wrapper.get('.to-source').trigger('click');
        await wrapper.get('.to-wysiwyg').trigger('click');

        expect(ueditor.setContentCalls).toContainEqual({
            content: '# Original',
            options: { contentType: 'markdown', emitUpdate: false },
        });
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('re-parses an external buffer change (a reload) into the WYSIWYG document', async () =>
    {
        ueditor.markdown = '# Current';
        const wrapper = mountEditor({ modelValue: '# Current' });

        await wrapper.setProps({ modelValue: '# Server version' });

        expect(ueditor.setContentCalls).toContainEqual({
            content: '# Server version',
            options: { contentType: 'markdown', emitUpdate: false },
        });
    });

    it('skips the re-parse when an incoming buffer change is its own serialization echo', async () =>
    {
        ueditor.markdown = '# Current';
        const wrapper = mountEditor({ modelValue: '# Current' });

        await wrapper.setProps({ modelValue: '# Current' });

        expect(ueditor.setContentCalls).toHaveLength(0);
    });

    it('opens a read-only session with a non-editable editor', () =>
    {
        mountEditor({ readOnly: true });

        expect(ueditor.editable).toBe(false);
    });

    it('propagates a later read-only change to the editor', async () =>
    {
        const wrapper = mountEditor({ readOnly: false });

        await wrapper.setProps({ readOnly: true });

        expect(ueditor.setEditableCalls).toContain(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownEditor formatting surface', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        ueditor.image = true;
        ueditor.mention = true;
        ueditor.layout = '';
    });

    it('mounts the fixed formatting toolbar, the slimmed bubble toolbar, and the slash menu in WYSIWYG', () =>
    {
        const wrapper = mountEditor();

        expect(wrapper.find('.format-toolbar').exists()).toBe(true);
        expect(wrapper.find('.bubble-toolbar').attributes('data-layout')).toBe('bubble');
        expect(wrapper.find('.slash-menu').exists()).toBe(true);
    });

    // The toolbar must stay MOUNTED across the toggle -- unmounting structure inside UEditor's slot breaks Vue's
    // patch anchors in the third-party-managed subtree. Hiding rides the whole WYSIWYG surface's v-show instead.
    it('hides the whole WYSIWYG surface (toolbar included) in Source mode without unmounting it', async () =>
    {
        const wrapper = mountEditor();
        const surface = () : HTMLElement => wrapper.get('.ueditor').element.parentElement as HTMLElement;
        expect(surface().style.display).not.toBe('none');
        expect(wrapper.find('.format-toolbar').exists()).toBe(true);

        await wrapper.get('.to-source').trigger('click');

        expect(surface().style.display).toBe('none');
        expect(wrapper.find('.format-toolbar').exists()).toBe(true);
    });

    it('drops the fixed formatting toolbar for a read-only viewer', () =>
    {
        const wrapper = mountEditor({ readOnly: true });

        expect(wrapper.find('.format-toolbar').exists()).toBe(false);
    });

    it('disables images and mentions so nothing that cannot serialize to GFM is offered', () =>
    {
        mountEditor();

        expect(ueditor.image).toBe(false);
        expect(ueditor.mention).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownEditor conflict', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        ueditor.setContentCalls = [];
        ueditor.setEditableCalls = [];
    });

    it('surfaces the store conflict through the conflict modal', async () =>
    {
        const store = useEditorStore();
        const wrapper = mountEditor();

        expect(wrapper.find('.conflict').exists()).toBe(false);

        store.$patch({ conflict: true });
        await wrapper.vm.$nextTick();

        expect(wrapper.find('.conflict').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
