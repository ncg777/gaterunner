<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Automation, ControlPoint, ControlValue, ParameterDefinition } from '../domain/development';
import { clamp, copyCurve, curveError, curvePath, editPoint, fitBeatRange, pointFromPosition, pointPosition, valueBounds } from '../domain/automationEditor';

const props = defineProps<{ curve: Automation; definition?: ParameterDefinition; baseValue: ControlValue; context: string }>();
const emit = defineEmits<{ change: [curve: Automation] }>();
const local = ref(copyCurve(props.curve)), selected = ref(-1), snap = ref(0.25), range = ref(fitBeatRange(props.curve.points));
const error = ref(''), tableOpen = ref(false), svg = ref<SVGSVGElement>();
const width = ref(800), height = 200;
const observer = new ResizeObserver(() => { if (svg.value) width.value = Math.max(140, svg.value.clientWidth - 110); });
onMounted(() => { if (svg.value) observer.observe(svg.value); });
onBeforeUnmount(() => observer.disconnect());
let gesture: { pointer: number; original: Automation; index: number; changed: boolean } | undefined;
const diagnostic = computed(() => curveError(local.value, props.definition));
const point = computed(() => local.value.points[selected.value]);
const path = computed(() => props.definition ? curvePath(local.value, props.definition, range.value, width.value, height) : '');
const visiblePoints = computed(() => local.value.points.map((p, index) => ({ ...p, index,
  position: props.definition ? pointPosition(p, props.definition, range.value) : { x: NaN, y: NaN } }))
  .filter(p => p.position.x >= 0 && p.position.x <= 1 && Number.isFinite(p.position.y) && p.position.y >= 0 && p.position.y <= 1));
const yTicks = computed(() => {
  if (!props.definition) return [];
  const definition = props.definition, [min, max] = valueBounds(definition);
  return definition.options ? definition.options.map((value, index) => ({ value: String(value), y: (1 - index / (max - min)) * height }))
    : Array.from({ length: 5 }, (_, i) => ({ value: format(min + (max - min) * i / 4), y: height - i * height / 4 }));
});
const xTicks = computed(() => Array.from({ length: 5 }, (_, i) => ({ x: i * width.value / 4, value: format(range.value.start + (range.value.end - range.value.start) * i / 4) })));
function format(value: number) { return Number(value.toPrecision(5)).toString(); }
function cancel() { if (gesture) local.value = gesture.original; gesture = undefined; error.value = ''; }
watch(() => props.curve, value => { cancel(); local.value = copyCurve(value); selected.value = Math.min(selected.value, value.points.length - 1); });
watch(() => props.context, () => { cancel(); selected.value = -1; range.value = fitBeatRange(props.curve.points); tableOpen.value = false; });
function commit(next: Automation) { local.value = next; error.value = ''; emit('change', copyCurve(next)); }
function update(index: number, candidate: ControlPoint, preview = false) {
  const result = editPoint(local.value, index, candidate, props.definition);
  if (typeof result === 'string') { error.value = result; return false; }
  selected.value = result.index;
  if (preview) local.value = result.curve; else commit(result.curve);
  return true;
}
function coordinate(event: PointerEvent) {
  const element = svg.value!;
  const matrix = element.getScreenCTM();
  if (!matrix) return;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return pointFromPosition(p.x / width.value, p.y / height, props.definition!, range.value, snap.value);
}
function down(event: PointerEvent, index = -1) {
  if (event.button !== 0 || !props.definition || diagnostic.value) return;
  event.preventDefault();
  const candidate = coordinate(event); if (!candidate) return;
  if (index < 0) {
    const existing = local.value.points.findIndex(p => p.beat === candidate.beat);
    if (existing >= 0) { selected.value = existing; focusPoint(); return; }
    update(-1, candidate); focusPoint(); return;
  }
  selected.value = index;
  gesture = { pointer: event.pointerId, original: copyCurve(local.value), index, changed: false };
  svg.value!.setPointerCapture(event.pointerId);
  focusPoint();
}
function move(event: PointerEvent) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const candidate = coordinate(event); if (!candidate) return;
  const current = local.value.points[gesture.index];
  if (current.beat === candidate.beat && current.value === candidate.value) return;
  if (update(gesture.index, candidate, true)) { gesture.index = selected.value; gesture.changed = true; }
}
function up(event: PointerEvent) {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const changed = gesture.changed, next = local.value; gesture = undefined;
  if (svg.value?.hasPointerCapture(event.pointerId)) svg.value.releasePointerCapture(event.pointerId);
  if (changed) commit(next);
  focusPoint();
}
function focusPoint() { nextTick(() => svg.value?.querySelector<SVGElement>(`[data-point-index="${selected.value}"]`)?.focus()); }
function remove(index: number) {
  const next = copyCurve(local.value); next.points.splice(index, 1); selected.value = Math.min(index, next.points.length - 1); commit(next); focusPoint();
}
function key(event: KeyboardEvent, index: number) {
  if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
  selected.value = index;
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(index); return; }
  if (!props.definition || diagnostic.value) return;
  const candidate = { ...local.value.points[index] }, definition = props.definition;
  const [min, max] = valueBounds(definition), delta = (event.shiftKey ? 10 : 1);
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') candidate.beat = clamp(candidate.beat + (event.key === 'ArrowRight' ? 1 : -1) * (snap.value || 0.01) * delta, 0, 1e7);
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    candidate.value = definition.options ? definition.options[clamp(definition.options.indexOf(candidate.value) + direction, min, max)]
      : clamp(Number(candidate.value) + direction * (max - min) / 100 * delta, min, max);
  } else return;
  event.preventDefault(); update(index, candidate); focusPoint();
}
function inputPoint(event: Event, index: number, field: 'beat' | 'value') {
  const input = event.target as HTMLInputElement, raw = input.value;
  if (!raw.trim() || !Number.isFinite(Number(raw))) { error.value = 'Enter a finite number.'; return; }
  update(index, { ...local.value.points[index], [field]: Number(raw) });
}
function optionPoint(event: Event, index: number) {
  const value = props.definition?.options?.[Number((event.target as HTMLSelectElement).value)];
  if (value !== undefined) update(index, { ...local.value.points[index], value });
}
function inputRange(event: Event, field: 'start' | 'end') {
  const raw = (event.target as HTMLInputElement).value, next = { ...range.value, [field]: Number(raw) };
  if (!raw.trim() || !Number.isFinite(next[field]) || next.start < 0 || next.end > 1e7 || next.end <= next.start) { error.value = 'Choose an increasing beat range between 0 and 10000000.'; return; }
  range.value = next; error.value = '';
}
function addPoint() {
  if (!props.definition) return;
  const beat = local.value.points.length ? local.value.points.at(-1)!.beat + 4 : range.value.start;
  const result = update(-1, { beat, value: local.value.points.at(-1)?.value ?? props.baseValue });
  if (result && beat > range.value.end) range.value.end = beat;
}
</script>

<template>
  <div class="automation-editor" :aria-label="`${definition?.label ?? curve.target} automation editor`" @keydown.esc="cancel">
    <div class="curve-toolbar">
      <span>{{ definition?.label ?? curve.target }} <span v-if="definition?.unit">· {{ definition.unit }}</span></span>
      <label>Snap <select v-model.number="snap" aria-label="Beat snap"><option :value="0">Off</option><option :value="1">1 beat</option><option :value="0.5">½ beat</option><option :value="0.25">¼ beat</option><option :value="0.125">⅛ beat</option><option :value="0.0625">¹⁄₁₆ beat</option></select></label>
      <label>From <input aria-label="Visible start beat" type="number" :value="range.start" step="any" @change="inputRange($event, 'start')"></label>
      <label>To <input aria-label="Visible end beat" type="number" :value="range.end" step="any" @change="inputRange($event, 'end')"></label>
      <button @click="range = fitBeatRange(local.points)">Fit points</button>
      <button :disabled="!definition" @click="addPoint">Add point</button>
    </div>
    <p class="curve-hint">Click to add · Drag to move · Arrow keys to adjust · Delete to remove · Escape to cancel a drag. {{ curve.clock === 'note' ? 'Beats since each note attack.' : 'Beats from song start.' }}</p>
    <div class="curve-graph">
      <svg ref="svg" :viewBox="`-90 -24 ${width + 110} 262`" preserveAspectRatio="none" role="group" :aria-label="`${definition?.label ?? curve.target} curve graph`"
        @pointermove="move" @pointerup="up" @pointercancel="cancel" @lostpointercapture="cancel">
        <rect class="curve-background" :width="width" height="200" @pointerdown="down($event)" />
        <g class="curve-grid" aria-hidden="true">
          <g v-for="tick in xTicks" :key="tick.x"><line :x1="tick.x" y1="0" :x2="tick.x" y2="200" /><text :x="tick.x" y="226" text-anchor="middle">{{ tick.value }}</text></g>
          <g v-for="tick in yTicks" :key="tick.value"><line x1="0" :y1="tick.y" :x2="width" :y2="tick.y" /><text x="-12" :y="tick.y + 4" text-anchor="end">{{ tick.value }}</text></g>
        </g>
        <svg :width="width" height="200" overflow="hidden" aria-hidden="true" class="curve-line-layer"><path :d="path" class="curve-line" /></svg>
        <circle v-for="p in visiblePoints" :key="p.index" :data-point-index="p.index" :cx="p.position.x * width" :cy="p.position.y * height" r="7" tabindex="0" role="button"
          :aria-label="`Point ${p.index + 1}, beat ${p.beat}, value ${p.value}`" :aria-pressed="selected === p.index" class="curve-point" :class="{ selected: selected === p.index }"
          @focus="selected = p.index" @pointerdown.stop="down($event, p.index)" @keydown="key($event, p.index)" />
        <text v-if="!local.points.length" :x="width / 2" y="100" text-anchor="middle" class="curve-empty">Click to begin</text>
      </svg>
    </div>
    <p v-if="error || diagnostic" role="alert" class="curve-error">{{ error || diagnostic }}</p>
    <div v-if="point" class="curve-point-fields">
      <strong>Point {{ selected + 1 }}</strong>
      <label>Beat <input aria-label="Selected point beat" type="number" step="any" :value="point.beat" @change="inputPoint($event, selected, 'beat')"></label>
      <label>Value <select v-if="definition?.options" aria-label="Selected point value" :value="definition.options.indexOf(point.value)" @change="optionPoint($event, selected)"><option v-for="(option, i) in definition.options" :key="i" :value="i">{{ option }}</option></select>
        <input v-else aria-label="Selected point value" type="number" step="any" :value="point.value" @change="inputPoint($event, selected, 'value')"></label>
      <button @click="remove(selected)">Delete selected point</button>
    </div>
    <details :open="tableOpen" @toggle="tableOpen = ($event.target as HTMLDetailsElement).open">
      <summary>All points ({{ local.points.length }})</summary>
      <div v-for="(p, index) in local.points" :key="index" class="curve-point-fields">
        <button @click="selected = index; focusPoint()">Point {{ index + 1 }}</button>
        <label>Beat <input :aria-label="`Point ${index + 1} beat`" type="number" step="any" :value="p.beat" @change="inputPoint($event, index, 'beat')"></label>
        <label>Value <select v-if="definition?.options" :aria-label="`Point ${index + 1} value`" :value="definition.options.indexOf(p.value)" @change="optionPoint($event, index)"><option v-for="(option, i) in definition.options" :key="i" :value="i">{{ option }}</option></select>
          <input v-else :aria-label="`Point ${index + 1} value`" type="number" step="any" :value="p.value" @change="inputPoint($event, index, 'value')"></label>
        <button :aria-label="`Delete point ${index + 1}`" @click="remove(index)">Delete</button>
      </div>
    </details>
  </div>
</template>

<style scoped>
.automation-editor { margin-top: 12px; color: var(--instrument-text, #ddd); font-size: 12px; }
.curve-toolbar, .curve-point-fields { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 8px 0; }
.curve-toolbar > span { margin-right: auto; font-weight: 600; }
label { display: inline-flex; gap: 6px; align-items: center; }
input, select, button { color: inherit; font: inherit; background: var(--panel-deep, #191d22); border: 1px solid var(--panel-border-soft, #505761); border-radius: 4px; padding: 5px 8px; }
input { width: 100px; } select { max-width: 160px; } button, summary { cursor: pointer; } button:disabled { opacity: .4; cursor: default; }
input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid #f2b84b; outline-offset: 2px; }
.curve-hint { color: var(--instrument-muted, #aeb6c0); font-size: 11px; margin: 8px 0; }
.curve-graph { background: var(--panel-inset, #15191e); border: 1px solid var(--panel-border-soft, #505761); border-radius: 5px; padding: 12px 8px; }
.curve-graph > svg { display: block; width: 100%; height: 250px; touch-action: none; overflow: visible; }
.curve-background { fill: #181e24; cursor: crosshair; }
.curve-grid, .curve-line-layer, .curve-empty { pointer-events: none; }
.curve-grid line { stroke: #8798a3; stroke-opacity: .18; vector-effect: non-scaling-stroke; }
.curve-grid text, .curve-empty { fill: #aeb8c4; font: 12px var(--font-mono, monospace); }
.curve-line { stroke: #81c8b0; stroke-width: 2; fill: none; vector-effect: non-scaling-stroke; }
.curve-point { fill: #202a30; stroke: #81c8b0; stroke-width: 2; cursor: grab; vector-effect: non-scaling-stroke; }
.curve-point.selected, .curve-point:focus { fill: #f2b84b; stroke: #fff0c7; outline: none; }
.curve-error { color: #ffb2a7; margin: 8px 0; }
details { margin-top: 12px; } summary { padding: 5px 0; }
@media (max-width: 600px) { input { width: 80px; } button, select, input { min-height: 44px; } .curve-graph > svg { height: 220px; } }
</style>
