import { helpTopics, type HelpTopic, type HelpSection } from './content';

function textOfSection(section: HelpSection): string {
  return [section.title, ...(section.paragraphs ?? []),
    ...(section.bullets ?? []), ...(section.steps ?? []), ...(section.table?.headings ?? []),
    ...(section.table?.rows.flat() ?? []), ...(section.links?.map(link => link.label) ?? []), section.code ?? ''].join(' ');
}
export function sectionText(topic: HelpTopic): string {
  return topic.sections.map(textOfSection).join(' ');
}
const normalize = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const termsFor = (query: string) => [...new Set(normalize(query).trim().split(/\s+/).filter(Boolean))];
export interface HelpSearchResult { topic: HelpTopic; excerpt: string; score: number }
const index = helpTopics.map(topic => ({ topic, body: sectionText(topic) }));

/** Literal, all-word matching across the entire article, with title matches first. */
export function searchHelp(query: string): HelpSearchResult[] {
  const terms = termsFor(query);
  if (!terms.length) return [];
  return index.flatMap(({ topic, body }) => {
    const title = normalize(topic.title), summary = normalize(topic.summary);
    const haystack = normalize(`${topic.title} ${topic.summary} ${topic.location} ${topic.keywords ?? ''} ${body}`);
    if (!terms.every(term => haystack.includes(term))) return [];
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 0)
      + (summary.includes(term) ? 3 : 0), 0);
    const firstMatch = terms.map(term => normalize(body).indexOf(term)).filter(i => i >= 0).sort((a, b) => a - b)[0];
    const start = Math.max(0, (firstMatch ?? 0) - 35);
    const excerpt = firstMatch === undefined ? topic.summary : `${start ? '…' : ''}${body.slice(start, start + 150)}${body.length > start + 150 ? '…' : ''}`;
    return [{ topic, excerpt, score }];
  }).sort((a, b) => b.score - a.score);
}

/** Take a result directly to the section containing the most query words. */
export function matchingHelpSection(topic: HelpTopic, query: string): number | undefined {
  const terms = termsFor(query);
  let best: number | undefined, bestScore = 0;
  topic.sections.forEach((section, index) => {
    const text = normalize(textOfSection(section));
    const score = terms.filter(term => text.includes(term)).length;
    if (score > bestScore) { best = index; bestScore = score; }
  });
  return best;
}
