import type * as Tone from 'tone';
import type { PresetData } from '../presets';
import { compileControl } from '../domain/development';

/** Use the live voices when every developed sound control has a live implementation.
 * Sample sources, other private sound locks and auxiliary returns retain the native renderer.
 * Timing, conditions, ties and velocity are already resolved by developmentSchedule.
 */
export function canPlayDevelopmentLive(project: PresetData): boolean {
  if (project.studio?.returns.length) return false;
  return project.tracks.every(track => {
    const d = track.development;
    if (!d?.enabled) return true;
    if (d.samples.length || d.snapshotCues.length) return false;
    const privateControlsUnsupported = (values: Record<string, unknown> | undefined) => Object.keys(values ?? {})
      .some(key => !['attack', 'decay', 'sustain', 'release'].includes(key) || track.trackKind === 'rhythmic' || track.polyphony === 1);
    if (d.steps.some(step => privateControlsUnsupported(step.locks) || step.slide !== undefined || step.legato !== undefined)) return false;
    if (d.patterns.some(pattern => Object.keys(pattern.overrides ?? {}).length
      || pattern.steps?.some(step => privateControlsUnsupported(step.locks) || step.slide !== undefined || step.legato !== undefined))) return false;
    return d.automation.every(curve => curve.lane === undefined && curve.clock !== 'note'
      && (curve.target === 'reverbWet' || (curve.target === 'filterFrequency' && track.trackKind !== 'rhythmic')));
  });
}

/** Schedule only the upcoming audio window, rather than rendering the entire song. */
export function scheduleLiveDevelopmentSends(context: Tone.BaseContext, project: PresetData,
  sends: ReadonlyMap<string, Tone.Gain>): () => void {
  const controls = project.tracks.flatMap(track => {
    const send = sends.get(track.id), d = track.development;
    if (!send || !d?.enabled || !d.automation.some(curve => curve.target === 'reverbWet')) return [];
    const curve = d.automation.filter(curve => curve.target === 'reverbWet').at(-1)!;
    const first = curve.points[0];
    const constant = first?.beat === 0 && curve.points.every(point => point.value === first.value)
      ? Number(first.value) : undefined;
    return [{ send, at: compileControl(d, 'reverbWet', track.reverbWet), constant }];
  });
  if (!controls.length) return () => {};
  const interval = 1 / 200;
  const animated = controls.filter(control => control.constant === undefined);
  const level = (value: number) => project.reverb.enabled ? 10 ** ((value + project.reverb.wet) / 20) : 0;
  let next = 0, origin = 0, started = false;
  const tick = () => {
    if (!started) return;
    const end = context.now() + interval * 2;
    for (; next <= end; next += interval) {
      const beat = Math.max(0, next - origin) * project.bpm / 60;
      for (const { send, at } of animated) send.gain.linearRampToValueAtTime(level(Number(at(beat))), next);
    }
  };
  const start = (time: number) => {
    origin = next = time; started = true;
    for (const { send, constant } of controls) if (constant !== undefined) send.gain.setValueAtTime(level(constant), time);
    if (animated.length) tick();
  };
  context.transport.on('start', start);
  if (animated.length) context.on('tick', tick);
  return () => {
    context.transport.off('start', start); context.off('tick', tick);
    for (const { send } of controls) send.gain.cancelAndHoldAtTime(context.now());
  };
}
