import { readFileSync, writeFileSync } from 'node:fs';
import { renderHelpManual } from '../src/help/manual';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const path = new URL('HELP.md', root);
const expected = renderHelpManual(version);
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== expected) {
    console.error('HELP.md is out of date. Run yarn help:generate.');
    process.exitCode = 1;
  } else console.log(`Help manual matches in-app content (${version}).`);
} else {
  writeFileSync(path, expected);
  console.log(`Generated HELP.md (${version}).`);
}
