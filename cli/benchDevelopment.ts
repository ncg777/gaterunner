import { mkdir, writeFile } from 'node:fs/promises';
import { loadProject, renderProject } from './projectApi.js';
import { MemoryRenderCache } from '../src/audio/renderCache.js';
const project = await loadProject('cli/fixtures/development-demo.json'), cache = new MemoryRenderCache();
const full = await renderProject(project,{cache});
const repeat = await renderProject(project,{cache});
const excerpt = await renderProject(project,{cache,range:{start:6,end:8,unit:'bars'}});
const coldExcerpt = await renderProject(project,{range:{start:6,end:8,unit:'bars'}});
const report = { environment:{node:process.version,platform:process.platform,renderer:'2026.10.7',sampleRate:48000},
  full:{...full.performance,...full.stats},cached:{...repeat.performance,...repeat.stats},excerpt:{...excerpt.performance,...excerpt.stats},coldExcerpt:{...coldExcerpt.performance,...coldExcerpt.stats},
  cachedSpeedup:full.performance.elapsedMilliseconds/repeat.performance.elapsedMilliseconds,
  excerptSpeedup:full.performance.elapsedMilliseconds/excerpt.performance.elapsedMilliseconds,
  excerptCacheSpeedup:coldExcerpt.performance.elapsedMilliseconds/excerpt.performance.elapsedMilliseconds,
  note:'Peak memory is the process high-water mark (maxRSS), not independent per-render memory. Working-buffer bytes are an estimate. No quality reduction; excerpts warm from origin.' };
await mkdir('dist/development-benchmark',{recursive:true}); await writeFile('dist/development-benchmark/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
