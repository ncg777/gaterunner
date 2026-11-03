import { validControl, type Automation, type ControlPoint, type ControlValue, type ParameterDefinition } from './development.js';

export const MAX_AUTOMATION_BEAT = 1e7;
export interface BeatRange { start: number; end: number }
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const copyCurve = (curve: Automation): Automation => ({ ...curve, points: curve.points.map(p => ({ ...p })) });

export function fitBeatRange(points: readonly ControlPoint[]): BeatRange {
  return { start: 0, end: Math.min(MAX_AUTOMATION_BEAT, Math.max(16, ...points.map(p => Number.isFinite(p.beat) ? p.beat : 0))) };
}
export function snapBeat(beat: number, step: number): number {
  return clamp(step > 0 ? Math.round(beat / step) * step : beat, 0, MAX_AUTOMATION_BEAT);
}
export function valueBounds(definition: ParameterDefinition): [number, number] {
  return definition.options ? [0, Math.max(1, definition.options.length - 1)] : [definition.min ?? 0, definition.max ?? 1];
}
export function pointPosition(point: ControlPoint, definition: ParameterDefinition, range: BeatRange) {
  const [min, max] = valueBounds(definition);
  const value = definition.options ? definition.options.indexOf(point.value) : Number(point.value);
  return { x: (point.beat - range.start) / (range.end - range.start), y: 1 - (value - min) / (max - min) };
}
export function pointFromPosition(x: number, y: number, definition: ParameterDefinition, range: BeatRange, snap: number): ControlPoint {
  const [min, max] = valueBounds(definition);
  const value = min + (1 - clamp(y, 0, 1)) * (max - min);
  return { beat: clamp(snapBeat(range.start + clamp(x, 0, 1) * (range.end - range.start), snap), range.start, range.end),
    value: definition.options ? definition.options[Math.round(value)] : value };
}
export function pointError(point: ControlPoint, definition: ParameterDefinition | undefined): string {
  if (!Number.isFinite(point.beat) || point.beat < 0 || point.beat > MAX_AUTOMATION_BEAT) return 'Beat must be between 0 and 10000000.';
  if (!definition) return 'This control is unsupported. Choose a supported control to edit its values.';
  if (!validControl(point.value, definition)) return 'Value is outside this control’s allowed values.';
  return '';
}
export function curveError(curve: Automation, definition: ParameterDefinition | undefined): string {
  if (!definition) return 'This control is unsupported. Choose a supported control to edit its values.';
  if (definition.options && curve.interpolation !== 'step') return 'Discrete controls require step interpolation.';
  let previous = -1;
  for (const point of curve.points) {
    const error = pointError(point, definition);
    if (error) return error;
    if (point.beat <= previous) return 'Points must have unique, increasing beats. Use the point table to repair this curve.';
    previous = point.beat;
  }
  return '';
}
/** Keep untouched imported points intact, including invalid values awaiting repair. */
export function editPoint(curve: Automation, index: number, point: ControlPoint, definition?: ParameterDefinition): { curve: Automation; index: number } | string {
  const error = pointError(point, definition);
  if (error) return error;
  if (curve.points.some((p, i) => i !== index && p.beat === point.beat)) return 'A point already exists at this beat.';
  const next = copyCurve(curve);
  if (index < 0) next.points.push(point); else next.points[index] = point;
  next.points.sort((a, b) => a.beat - b.beat);
  return { curve: next, index: next.points.indexOf(point) };
}
export function retargetCurve(curve: Automation, target: string, definition: ParameterDefinition, base: ControlValue): Automation {
  const next = copyCurve(curve);
  next.target = target;
  const fallback = validControl(base, definition) ? base : definition.options?.[0] ?? definition.min ?? 0;
  next.points = next.points.map(p => ({ ...p, value: validControl(p.value, definition) ? p.value
    : !definition.options && typeof p.value === 'number' && Number.isFinite(p.value)
      ? clamp(p.value, definition.min ?? -Infinity, definition.max ?? Infinity) : fallback }));
  if (definition.options) next.interpolation = 'step';
  if (definition.scope === 'bus') { next.clock = 'song'; delete next.lane; }
  return next;
}

/** Exact smoothstep geometry: linear x and cubic y with horizontal endpoint tangents. */
export function curvePath(curve: Automation, definition: ParameterDefinition, range: BeatRange, width: number, height: number): string {
  if (!curve.points.length || curveError(curve, definition)) return '';
  const position = (point: ControlPoint) => {
    const p = pointPosition(point, definition, range); return { x: p.x * width, y: p.y * height };
  };
  let previous = position(curve.points[0]);
  let path = `M ${previous.x} ${previous.y}`;
  for (const point of curve.points.slice(1)) {
    const next = position(point), dx = (next.x - previous.x) / 3;
    path += curve.interpolation === 'step' ? ` H ${next.x} V ${next.y}`
      : curve.interpolation === 'smooth' ? ` C ${previous.x + dx} ${previous.y} ${next.x - dx} ${next.y} ${next.x} ${next.y}`
        : ` L ${next.x} ${next.y}`;
    previous = next;
  }
  return `${path} H ${Math.max(width, previous.x)}`;
}
