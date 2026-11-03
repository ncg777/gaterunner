import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { helpTopics, dockHelpTopics, editorHelpTopics } from '../help/content';
import { searchHelp, matchingHelpSection } from '../help/search';
import { renderHelpManual } from '../help/manual';

test('help topics have valid navigation destinations, references and table columns', () => {
  const ids = new Set(helpTopics.map(topic => topic.id));
  assert.equal(ids.size, helpTopics.length);
  for (const topic of helpTopics) {
    for (const id of topic.related) assert.ok(ids.has(id), `${topic.id} links to missing ${id}`);
    for (const section of topic.sections) {
      for (const id of section.topics ?? []) assert.ok(ids.has(id), `Missing shortcut: ${id}`);
      for (const row of section.table?.rows ?? []) assert.equal(row.length, section.table!.headings.length, `${topic.id}: ${section.title}`);
    }
    if (topic.target) assert.ok((topic.target.kind === 'editor' ? editorHelpTopics : dockHelpTopics)[topic.target.value], `Invalid target in ${topic.id}`);
  }
  for (const id of [...Object.values(editorHelpTopics), ...Object.values(dockHelpTopics)]) assert.ok(ids.has(id));
});

test('every visible editor tab has contextual help', () => {
  const editor = readFileSync(new URL('../components/EditorSurface.vue', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
  for (const match of editor.matchAll(/<v-tab\b[^>]*\bvalue="([\w-]+)"/g)) {
    if (['a', 'b'].includes(match[1])) continue;
    assert.ok(editorHelpTopics[match[1]], `Missing reference for ${match[1]}`);
  }
  for (const match of app.matchAll(/@click="openDock\('([\w-]+)'\)"/g)) {
    if (match[1] !== 'editor') assert.ok(dockHelpTopics[match[1]], `Missing dock reference for ${match[1]}`);
  }
});

test('search finds details, tutorials and controls, ranks titles first and treats input literally', () => {
  assert.equal(searchHelp('granular')[0].topic.id, 'granular');
  assert.ok(searchHelp('exclusive end').some(result => result.topic.id === 'render'));
  assert.ok(searchHelp('ROOT midi').some(result => result.topic.id === 'samples'));
  assert.ok(searchHelp('velocity layers').some(result => result.topic.id === 'samples'));
  assert.ok(searchHelp('9,007,199,254,740,991').some(result => result.topic.id === 'sequence'));
  assert.ok(searchHelp('sin(k*x+p)').some(result => result.topic.id === 'drive'));
  assert.deepEqual(searchHelp('  '), []);
  assert.deepEqual(searchHelp('[.*'), []);
  assert.deepEqual(searchHelp('granular nonexistentword'), []);
  assert.ok(searchHelp('before inserts').some(result => result.excerpt.includes('inserts')));
  const render = helpTopics.find(topic => topic.id === 'render')!;
  assert.equal(render.sections[matchingHelpSection(render, 'exclusive end')!].title, 'Selected ranges and preparation');
  assert.equal(matchingHelpSection(render, 'xyzxyz'), undefined);
});

test('the published manual matches the in-app guide and current release', () => {
  const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  assert.equal(readFileSync(new URL('../../HELP.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), renderHelpManual(version));
});
