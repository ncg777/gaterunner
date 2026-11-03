<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { helpTopics, type HelpTopic } from '../help/content';
import { searchHelp, matchingHelpSection } from '../help/search';

const props = defineProps<{ appVersion: string; topic?: string | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ navigate: [target: NonNullable<HelpTopic['target']>] }>();
const query = ref(''), activeId = ref('welcome'), contentsOpen = ref(false);
const searchInput = ref<HTMLInputElement>(), article = ref<HTMLElement>(), heading = ref<HTMLElement>();
const history = ref<{ id: string; scroll: number }[]>([]);
const active = computed(() => helpTopics.find(topic => topic.id === activeId.value) ?? helpTopics[0]);
const groups = [...new Set(helpTopics.map(topic => topic.group))].map(name => ({ name, topics: helpTopics.filter(topic => topic.group === name) }));
const results = computed(() => searchHelp(query.value));
const searching = computed(() => !!query.value.trim());
const related = computed(() => active.value.related.map(id => helpTopics.find(topic => topic.id === id)!).filter(Boolean));
const topicById = Object.fromEntries(helpTopics.map(topic => [topic.id, topic]));

async function selectTopic(id: string, record = true) {
  if (!helpTopics.some(topic => topic.id === id)) id = 'welcome';
  if (record && id !== activeId.value) history.value.push({ id: activeId.value, scroll: article.value?.scrollTop ?? 0 });
  activeId.value = id;
  contentsOpen.value = false;
  await nextTick();
  if (article.value) article.value.scrollTop = 0;
  heading.value?.focus({ preventScroll: true });
}
async function goBack() {
  const previous = history.value.pop();
  if (!previous) return;
  await selectTopic(previous.id, false);
  if (article.value) article.value.scrollTop = previous.scroll;
}
async function openResult(topic: HelpTopic) {
  await selectTopic(topic.id);
  const section = matchingHelpSection(topic, query.value);
  if (section !== undefined) jumpToSection(section);
}
function jumpToSection(index: number) {
  const section = article.value?.querySelector<HTMLElement>(`#help-section-${index}`);
  section?.scrollIntoView({ block: 'start' });
  section?.focus({ preventScroll: true });
}
function openControls() {
  if (!active.value.target) return;
  visible.value = false;
  emit('navigate', active.value.target);
}
function focusSearch() { searchInput.value?.focus(); }
watch(() => [visible.value, props.topic] as const, ([open, topic]) => {
  if (open && topic) { query.value = ''; void selectTopic(topic); }
});
watch(query, () => { if (searching.value) contentsOpen.value = true; });
function afterEnter() { if (props.topic) heading.value?.focus({ preventScroll: true }); else focusSearch(); }
</script>

<template>
  <v-dialog v-model="visible" eager max-width="1120" :fullscreen="$vuetify.display.width <= 700" aria-labelledby="help-title" @after-enter="afterEnter">
    <div class="help-shell" @keydown.f1.prevent.stop="focusSearch">
      <header class="help-header">
        <div class="help-brand"><v-icon size="20">mdi-book-open-page-variant-outline</v-icon><strong id="help-title">GateRunner help</strong><small>{{ appVersion }}</small></div>
        <button class="help-close" aria-label="Close help" title="Close help (Escape)" @click="visible = false"><v-icon size="20">mdi-close</v-icon></button>
      </header>
      <div class="help-tools">
        <button :disabled="!history.length" aria-label="Previous help topic" title="Back to previous topic" @click="goBack"><v-icon size="18">mdi-arrow-left</v-icon></button>
        <button class="help-contents-toggle" :aria-expanded="contentsOpen" aria-controls="help-contents" @click="contentsOpen = !contentsOpen">{{ contentsOpen ? 'Read topic' : 'Contents' }}</button>
        <div class="help-search">
          <v-icon size="18" aria-hidden="true">mdi-magnify</v-icon>
          <input ref="searchInput" v-model="query" type="search" aria-label="Search help" placeholder="Search features, controls & tutorials…" autocomplete="off" @keydown.enter.prevent="results[0] && openResult(results[0].topic)">
          <button v-if="query" class="help-clear" aria-label="Clear help search" @click="query = ''; focusSearch()"><v-icon size="16">mdi-close</v-icon></button>
        </div>
        <span class="help-count" role="status" aria-live="polite">{{ searching ? `${results.length} results` : `${helpTopics.length} topics` }}</span>
      </div>
      <div class="help-layout" :class="{ 'show-contents': contentsOpen }">
        <nav id="help-contents" class="help-contents" aria-label="Help table of contents">
          <template v-if="searching">
            <h2 class="help-group-title">Search results</h2>
            <p v-if="!results.length" class="help-no-results">No topics match “{{ query }}”. Try fewer words or a control name.<button @click="query = ''">Show all topics</button></p>
            <button v-for="result in results" :key="result.topic.id" class="help-topic-link help-result" :class="{ selected: activeId === result.topic.id }" :aria-current="activeId === result.topic.id ? 'page' : undefined" @click="openResult(result.topic)">
              <strong>{{ result.topic.title }}</strong><span>{{ result.excerpt }}</span>
            </button>
          </template>
          <template v-else>
            <div v-for="group in groups" :key="group.name" class="help-group">
              <h2 class="help-group-title">{{ group.name }}</h2>
              <button v-for="topic in group.topics" :key="topic.id" class="help-topic-link" :class="{ selected: activeId === topic.id }" :aria-current="activeId === topic.id ? 'page' : undefined" @click="selectTopic(topic.id)">{{ topic.title }}</button>
            </div>
          </template>
        </nav>
        <article ref="article" class="help-article" aria-labelledby="help-topic-title" tabindex="0">
          <div class="help-location">{{ active.group }}<span>{{ active.location }}</span></div>
          <h2 id="help-topic-title" ref="heading" tabindex="-1">{{ active.title }}</h2>
          <p class="help-summary">{{ active.summary }}</p>
          <div class="help-topic-tools">
            <button v-if="active.target" class="help-open-controls" @click="openControls">Open controls <v-icon size="14">mdi-arrow-top-right</v-icon></button>
            <nav v-if="active.sections.length > 1" aria-label="On this page" class="help-section-links"><button v-for="(section, index) in active.sections" :key="index" @click="jumpToSection(index)">{{ section.title }}</button></nav>
          </div>
          <section v-for="(section, index) in active.sections" :key="`${active.id}-${index}`" class="help-section">
            <h3 :id="`help-section-${index}`" tabindex="-1">{{ section.title }}</h3>
            <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
            <ul v-if="section.bullets"><li v-for="item in section.bullets" :key="item">{{ item }}</li></ul>
            <ol v-if="section.steps" class="help-steps"><li v-for="item in section.steps" :key="item">{{ item }}</li></ol>
            <div v-if="section.table" class="help-table-scroll"><table><caption class="help-sr-only">{{ section.title }}</caption><thead><tr><th v-for="label in section.table.headings" :key="label" scope="col">{{ label }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in section.table.rows" :key="rowIndex"><th scope="row">{{ row[0] }}</th><td v-for="(cell, cellIndex) in row.slice(1)" :key="cellIndex">{{ cell }}</td></tr></tbody></table></div>
            <pre v-if="section.code"><code>{{ section.code }}</code></pre>
            <div v-if="section.topics" class="help-quick-links"><button v-for="id in section.topics" :key="id" @click="selectTopic(id)"><strong>{{ topicById[id].title.replace('Tutorial: ', '') }} <span aria-hidden="true">→</span></strong><span>{{ topicById[id].summary }}</span></button></div>
            <div v-if="section.links" class="help-external-links"><a v-for="link in section.links" :key="link.href" :href="link.href" target="_blank" rel="noopener noreferrer">{{ link.label }} ↗</a></div>
          </section>
          <nav class="help-related" aria-label="Related help topics"><strong>Related</strong><button v-for="topic in related" :key="topic.id" @click="selectTopic(topic.id)">{{ topic.title }} <span aria-hidden="true">→</span></button></nav>
        </article>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.help-shell { display: flex; flex-direction: column; height: min(820px, 90dvh); min-height: 0; overflow: hidden; background: #20262c; color: #e5eaf0; font: 13px/1.55 "Segoe UI", sans-serif; border: 1px solid #47515c; border-radius: 10px; }
.help-header, .help-brand, .help-tools, .help-search { display: flex; align-items: center; }
.help-header { padding: 10px 14px; gap: 12px; border-bottom: 1px solid #39434e; }
.help-brand { gap: 9px; flex: 1; min-width: 0; }
.help-brand strong { font-size: 15px; }.help-brand small { color: #a8b5c2; font-size: 11px; }
button { color: inherit; font: inherit; cursor: pointer; border-radius: 4px; }
.help-close, .help-tools > button, .help-clear { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; }
button:hover { background: #34424b; }button:disabled { opacity: .35; cursor: default; }
button:focus-visible, input:focus-visible, article:focus-visible { outline: 2px solid #a1dacb; outline-offset: -2px; }
h2:focus, h3:focus { outline: none; }
.help-tools { flex: 0 0 auto; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #39434e; }
.help-search { flex: 1; min-width: 0; gap: 8px; padding: 0 8px; border: 1px solid #53626d; border-radius: 5px; background: #161d22; }
.help-search input { min-width: 0; width: 100%; height: 34px; color: inherit; font: inherit; outline-offset: 0; }
.help-search input::placeholder { color: #a8b5c2; }.help-search input::-webkit-search-cancel-button { display: none; }
.help-count { font-size: 11px; color: #afbdc9; white-space: nowrap; }
.help-layout { display: grid; grid-template-columns: 255px minmax(0, 1fr); min-height: 0; flex: 1; }
.help-contents { overflow: auto; overscroll-behavior: contain; padding: 10px 8px 18px; border-right: 1px solid #39434e; background: #192127; }
.help-group + .help-group { margin-top: 13px; }
.help-group-title { color: #9eafbd; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; margin: 4px 8px; }
.help-topic-link { display: block; text-align: left; width: 100%; padding: 5px 8px; line-height: 1.4; font-size: 12px; border-left: 2px solid transparent; }
.help-topic-link.selected { border-left-color: #a1dacb; color: #c6f4e7; background: #2a403f; }
.help-result { padding: 9px 8px; border-bottom: 1px solid #313e46; }.help-result strong, .help-result span { display: block; }.help-result span { color: #b2bec8; font-size: 11px; margin-top: 4px; }
.help-no-results { margin: 12px 8px; }.help-no-results button { display: block; color: #b0e5d9; margin-top: 12px; padding: 6px; text-decoration: underline; }
.help-article { min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 18px 24px 24px; scroll-padding-top: 16px; }
.help-location { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #a1dacb; }.help-location span { display: block; color: #afbdc9; text-transform: none; letter-spacing: 0; font-size: 11px; margin-top: 3px; }
.help-article h2 { font-size: 24px; line-height: 1.2; font-weight: 650; margin: 7px 0; }.help-summary { color: #c0cbd4; margin-bottom: 12px; }
.help-topic-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid #3a454f; }
.help-open-controls { border: 1px solid #648b81; background: #29413d; color: #c6f4e7; padding: 4px 9px; white-space: nowrap; }
.help-section-links { display: flex; flex-wrap: wrap; gap: 4px 12px; }.help-section-links button { color: #b0e5d9; text-decoration: underline; font-size: 11px; padding: 2px 0; }
.help-section { margin-top: 18px; }.help-section h3 { color: #f0f4f7; font-size: 15px; margin: 0 0 7px; }.help-section p + p { margin-top: 9px; }
.help-section ul, .help-section ol { padding-left: 22px; margin-top: 8px; }.help-section li { padding-left: 2px; margin: 6px 0; }.help-steps li { padding-left: 5px; margin: 11px 0; }.help-steps li::marker { font-weight: 700; color: #a1dacb; }
.help-table-scroll { overflow-x: auto; margin-top: 9px; }table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.5; }th, td { text-align: left; vertical-align: top; padding: 7px 9px; border-bottom: 1px solid #3a454f; }thead th { background: #2b363f; font-weight: 600; color: #c7d5df; }tbody th { width: 29%; font-weight: 600; color: #d2e4df; }tbody tr:nth-child(even) { background: #232d35; }
pre { overflow-x: auto; margin-top: 10px; padding: 12px; background: #151c21; border: 1px solid #3a454f; border-radius: 5px; font: 12px/1.65 Consolas, monospace; }
.help-related { border-top: 1px solid #3a454f; margin-top: 22px; padding-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 12px; }.help-related strong { color: #afbdc9; font-size: 11px; }.help-related button { color: #b0e5d9; padding: 4px 0; font-size: 12px; }
.help-quick-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }.help-quick-links button { text-align: left; padding: 9px 11px; border: 1px solid #435750; background: #283b37; }.help-quick-links button:hover { background: #344d46; }.help-quick-links strong { display: block; color: #c6f4e7; text-transform: capitalize; }.help-quick-links button > span { display: block; margin-top: 3px; color: #c0cbd4; font-size: 11px; }.help-external-links { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; }.help-external-links a { color: #b0e5d9; }.help-external-links a:focus-visible { outline: 2px solid #a1dacb; }
.help-tools > .help-contents-toggle { display: none; }.help-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 700px) {
  .help-shell { height: 100dvh; border-radius: 0; border: 0; }.help-brand { flex-wrap: wrap; gap: 5px; }.help-brand small { font-size: 10px; }
  .help-tools { gap: 4px; padding: 7px; }.help-tools > .help-contents-toggle { display: inline-flex; font-size: 11px; padding: 0 5px; }.help-count { display: none; }
  .help-search { gap: 4px; padding: 0 5px; }.help-search input { font-size: 12px; }
  .help-layout { display: block; overflow: hidden; }.help-article, .help-contents { height: 100%; }.help-article { padding: 15px; }.help-article h2 { font-size: 21px; }
  .help-contents { display: none; border-right: 0; }.show-contents .help-contents { display: block; }.show-contents .help-article { display: none; }
  .help-topic-link { padding: 9px 10px; font-size: 13px; }.help-section-links button { padding: 5px 0; }tbody th { width: 34%; }th, td { padding: 7px 6px; }
  .help-quick-links { grid-template-columns: 1fr; }
}
</style>
