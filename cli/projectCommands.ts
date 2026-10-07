import type { Command } from 'commander';
import { writeFile, readFile } from 'node:fs/promises';
import { supportedFeatures, loadProject, validateProject, resolveProjectEvents, renderProject, exportStems,
  bounceSample, exportProjectPackage, importWavAsset } from './projectApi.js';
import { normalizeStudio } from '../src/domain/development.js';
import type { RenderRange } from '../src/audio/developmentRender.js';
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
let activeController:AbortController|undefined;
const action = (fn: (options: any) => Promise<void>) => async (options: any) => {
  const controller=new AbortController(),cancel=()=>controller.abort(new Error('Render cancelled'));
  activeController=controller;process.once('SIGINT',cancel);
  try { await fn(options); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  finally{process.off('SIGINT',cancel);activeController=undefined;}
};
function range(options: any): RenderRange | undefined {
  if (options.start === undefined && options.end === undefined) return undefined;
  if (options.end === undefined) throw new Error('--end is required when --start is used');
  if (!['bars', 'beats', 'seconds'].includes(options.unit)) throw new Error('--unit must be bars, beats or seconds');
  return { start: Number(options.start ?? 0), end: Number(options.end), unit: options.unit };
}
function renderOptions(options: any) {
  return { range: range(options), cacheDirectory: options.cacheDir,
    signal:activeController?.signal,
    onProgress: options.verbose ? (p: { completed: number; total: number; stage: string }) => console.error(`${p.completed}/${p.total} ${p.stage}`) : undefined };
}
function renderFlags(command: Command) {
  return command.requiredOption('-p, --project <file>', 'Preset, raw project, library, or portable asset package')
    .option('--start <number>', 'Range start (zero-based)') .option('--end <number>', 'Exclusive range end')
    .option('--unit <unit>', 'Range units: bars, beats or seconds', 'bars')
    .option('--cache-dir <directory>', 'Validated completed-track cache') .option('--verbose', 'Show progress');
}
export function registerProjectCommands(program: Command) {
  program.command('features').description('Query capabilities and parameter definitions').action(() => print(supportedFeatures()));
  program.command('validate').requiredOption('-p, --project <file>').option('-o, --output <file>', 'Write normalized project')
    .action(action(async options => {
      const raw = JSON.parse(await readFile(options.project, 'utf8'));
      const result = validateProject(raw.type === 'gaterunner-asset-package' ? raw.project : raw.preset?.data
        ?? (raw.kind==='preset-library'?raw.presets?.find((p:{id:string})=>p.id===raw.selectedPresetId)?.data ?? raw.presets?.[0]?.data:raw));
      if (raw.type === 'gaterunner-asset-package' && raw.version !== 1) {
        result.valid = false;
        result.diagnostics.unshift({path:'version',severity:'error',message:'Unsupported asset package version'});
      }
      if (options.output) await writeFile(options.output, JSON.stringify(result.project, null, 2) + '\n');
      print({ valid: result.valid, diagnostics: result.diagnostics }); if (!result.valid) process.exitCode = 1;
    }));
  program.command('resolve').requiredOption('-p, --project <file>').option('-o, --output <file>')
    .action(action(async options => { const events = await resolveProjectEvents(await loadProject(options.project));
      if (options.output) await writeFile(options.output, JSON.stringify(events, null, 2) + '\n'); else print(events); }));
  renderFlags(program.command('render')).requiredOption('-o, --output <file>').option('--report <file>')
    .action(action(async options => { const rendered = await renderProject(await loadProject(options.project), { ...renderOptions(options), output: options.output });
      const report = { file: rendered.file, range: rendered.range, measurements: rendered.measurements, performance: rendered.performance, cache: rendered.stats };
      if (options.report) await writeFile(options.report, JSON.stringify(report, null, 2) + '\n'); print(report); }));
  renderFlags(program.command('stems')).requiredOption('-o, --output <directory>')
    .option('--stem-stage <stage>','all, pre (dry sources) or post (tracks and wet returns)','all')
    .option('--no-lane-stems','Omit individual drum sources').option('--no-pre-insert-stems','Omit track sources before inserts')
    .action(action(async options => print(await exportStems(await loadProject(options.project), options.output, {...renderOptions(options),stemStage:options.stemStage,laneStems:options.laneStems,preInsertStems:options.preInsertStems}))));
  renderFlags(program.command('bounce')).requiredOption('-o, --output <file>').option('--source <id>', 'mix, track ID or return ID', 'mix')
    .option('--name <name>', 'Reusable sample name', 'Bounce')
    .action(action(async options => { const project = await loadProject(options.project), asset = await bounceSample(project, options.name, options.source, renderOptions(options));
      project.studio ??= normalizeStudio({})!; project.studio.assets = [...project.studio.assets.filter(a => a.hash !== asset.hash), asset];
      print(await exportProjectPackage(project, options.output)); }));
  program.command('pack').requiredOption('-p, --project <file>').requiredOption('-o, --output <file>')
    .action(action(async options => print(await exportProjectPackage(await loadProject(options.project), options.output))));
  program.command('sample').requiredOption('-p, --project <file>').requiredOption('-i, --input <wav>').requiredOption('-o, --output <file>')
    .action(action(async options => { const project = await loadProject(options.project), asset = await importWavAsset(await readFile(options.input), options.input);
      project.studio ??= normalizeStudio({})!; project.studio.assets = [...project.studio.assets.filter(a => a.hash !== asset.hash), asset];
      print(await exportProjectPackage(project, options.output)); }));
}
