<template>
  <v-expansion-panels class="development-panel" variant="accordion">
    <v-expansion-panel title="Phrases, motion & studio">
      <v-expansion-panel-text>
        <p>Keep a recognizable groove while changing its phrasing and sound. These controls are optional.</p>
        <v-switch v-model="development.enabled" label="Develop this track" hide-details @update:model-value="changed" />
        <v-text-field v-model.number="development.seed" label="Saved variation seed" type="number" density="compact" @change="changed" />
        <v-tabs v-model="tab"><v-tab value="phrases">Phrases</v-tab><v-tab value="steps">Articulation</v-tab><v-tab value="motion">Motion</v-tab><v-tab value="returns">Dub returns</v-tab><v-tab value="samples">Samples</v-tab><v-tab value="render">Render</v-tab></v-tabs>
        <v-window v-model="tab" :touch="false">
          <v-window-item value="phrases">
            <v-btn class="my-2" @click="capturePattern">Capture sequence</v-btn>
            <div v-for="pattern in development.patterns" :key="pattern.id" class="studio-row">
              <v-text-field v-model="pattern.name" label="Phrase name" @change="changed" />
              <v-text-field v-model="pattern.sequence" label="Integer sequence" @change="changed" />
              <v-btn icon="mdi-delete" variant="text" @click="removePattern(pattern.id)" />
              <v-expansion-panels><v-expansion-panel title="Phrase sound overrides"><v-expansion-panel-text>
                <div class="studio-row"><v-select v-model="lockTarget" :items="voiceTargets" label="Setting" /><v-btn :disabled="!lockTarget" @click="pattern.overrides ??= {}; pattern.overrides[lockTarget]=baseValue(lockTarget); changed()">Override setting</v-btn></div>
                <div v-for="(_value,target) in pattern.overrides" :key="target" class="studio-row"><v-select v-if="definitions[target]?.options" v-model="pattern.overrides![target]" :items="definitions[target].options!.map(v=>({title:String(v),value:v}))" :label="definitions[target].label" @update:model-value="changed" /><v-text-field v-else v-model.number="pattern.overrides![target]" type="number" :label="definitions[target]?.label ?? target" @change="changed" /><v-btn icon="mdi-delete" @click="delete pattern.overrides![target]; changed()" /></div>
              </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
            </div>
            <p>Sections restart phrase phase and padding. Cut ends the gate at the boundary; carry allows a release or tie to continue.</p>
            <v-btn :disabled="!development.patterns.length" @click="addSection">Add section</v-btn>
            <div v-for="(section, index) in development.sections" :key="section.id" class="studio-section">
              <div class="studio-row">
                <v-text-field v-model="section.name" label="Section" @change="changed" />
                <v-select v-model="section.pattern" :items="patternItems" label="Phrase" @update:model-value="changed" />
                <v-text-field v-model.number="section.length" label="Length" type="number" @change="changed" />
                <v-select v-model="section.unit" :items="['bars','beats']" label="Unit" @update:model-value="changed" />
                <v-select v-model="section.boundary" :items="['cut','carry']" label="Boundary" @update:model-value="changed" />
                <v-checkbox v-model="section.fill" label="Fill" hide-details @update:model-value="changed" />
                <v-btn :disabled="index === 0" icon="mdi-arrow-up" @click="moveSection(index)" />
                <v-btn icon="mdi-delete" @click="development.sections.splice(index, 1); changed()" />
              </div>
              <v-expansion-panels><v-expansion-panel title="Conditional phrase choices"><v-expansion-panel-text>
                <v-btn @click="section.choices ??= []; section.choices.push({ pattern: section.pattern, condition: { probability: 0.25 } }); changed()">Add choice</v-btn>
                <div v-for="(choice, i) in section.choices" :key="i" class="studio-row">
                  <v-select v-model="choice.pattern" :items="patternItems" label="Alternative phrase" @update:model-value="changed" />
                  <v-text-field :model-value="choice.condition.every" type="number" label="Every N repetitions" @update:model-value="choice.condition.every=optionalNumber($event); changed()" />
                  <v-text-field :model-value="choice.condition.probability" type="number" label="Chance (0–1)" @update:model-value="choice.condition.probability=optionalNumber($event); changed()" />
                  <v-checkbox v-model="choice.condition.first" label="First only" @update:model-value="changed" />
                  <v-checkbox :model-value="choice.condition.fill" label="Fill only" @update:model-value="choice.condition.fill=$event?true:undefined; changed()" />
                  <v-btn icon="mdi-delete" @click="section.choices?.splice(i, 1); changed()" />
                </div>
              </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
            </div>
            <p v-if="!development.sections.length">Without sections, the original sequence and repeat controls still set the track length.</p>
          </v-window-item>
          <v-window-item value="steps">
            <v-select v-model="stepPattern" :items="[{title:'All phrases',value:''}, ...patternItems]" label="Articulation scope" />
            <v-btn @click="addStep">Add step control</v-btn>
            <p>Steps and drum lanes start at 0. An empty lane/note applies to the whole event. Locks reset on every attack.</p>
            <v-card v-for="(step, index) in activeSteps" :key="index" class="my-2 pa-3" variant="outlined">
              <div class="studio-row">
                <v-text-field v-model.number="step.step" label="Step" type="number" @change="changed" />
                <v-select v-if="track.trackKind === 'rhythmic'" :model-value="step.lane" :items="laneItems" clearable label="Lane" @update:model-value="step.lane=optionalNumber($event); changed()" />
                <v-text-field v-else :model-value="step.note" label="MIDI note (optional)" type="number" @update:model-value="step.note = optionalNumber($event); changed()" />
                <v-text-field :model-value="step.velocity" label="Velocity (0–1)" type="number" @update:model-value="step.velocity = optionalNumber($event); changed()" />
                <v-text-field v-model.number="step.gate" label="Gate ×" type="number" @change="changed" />
                <v-checkbox v-if="track.trackKind !== 'rhythmic'" v-model="step.tie" label="Tie" @update:model-value="changed" />
                <v-btn icon="mdi-delete" @click="activeSteps.splice(index, 1); changed()" />
              </div>
              <v-expansion-panels><v-expansion-panel title="Accent, slide, conditions & locks"><v-expansion-panel-text>
                <div class="studio-row">
                  <v-text-field :model-value="step.durationBeats" label="Duration (beats)" type="number" @update:model-value="step.durationBeats = optionalNumber($event); changed()" />
                  <v-text-field v-if="track.polyphony === 1 && track.trackKind !== 'rhythmic'" :model-value="step.slide" label="Slide (seconds)" type="number" @update:model-value="step.slide = optionalNumber($event); changed()" />
                  <v-checkbox v-if="track.polyphony === 1 && track.trackKind !== 'rhythmic'" v-model="step.legato" label="Legato" @update:model-value="changed" />
                  <v-text-field v-model.number="step.offsetBeats" label="Timing offset (beats)" type="number" @change="changed" />
                  <v-text-field v-model.number="step.timingVariation" label="Timing variation ± beats" type="number" @change="changed" />
                  <v-text-field v-model.number="step.velocityVariation" label="Velocity variation ±" type="number" @change="changed" />
                </div>
                <div class="studio-row">
                  <v-text-field :model-value="step.condition?.every" label="Every N repetitions" type="number" @update:model-value="step.condition ??= {}; step.condition.every = optionalNumber($event); changed()" />
                  <v-text-field :model-value="step.condition?.probability" label="Chance (0–1)" type="number" @update:model-value="step.condition ??= {}; step.condition.probability = optionalNumber($event); changed()" />
                  <v-checkbox :model-value="step.condition?.first" label="First only" @update:model-value="step.condition ??= {}; step.condition.first = Boolean($event); changed()" />
                  <v-checkbox :model-value="step.condition?.fill" label="Fill only" @update:model-value="step.condition ??= {}; step.condition.fill = $event ? true : undefined; changed()" />
                </div>
                <div class="studio-row"><v-select v-model="lockTarget" :items="voiceTargets" label="Lock target" /><v-btn :disabled="!lockTarget" @click="addLock(step)">Add lock</v-btn></div>
                <div v-for="(_value, target) in step.locks" :key="target" class="studio-row">
                  <v-select v-if="definitions[target]?.options" v-model="step.locks![target]" :items="definitions[target].options!.map(v=>({title:String(v),value:v}))" :label="definitions[target].label" @update:model-value="changed" />
                  <v-text-field v-else v-model.number="step.locks![target]" type="number" :label="definitions[target]?.label ?? target" :min="definitions[target]?.min" :max="definitions[target]?.max" @change="changed" />
                  <v-btn icon="mdi-delete" @click="delete step.locks![target]; changed()" />
                </div>
              </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
            </v-card>
          </v-window-item>
          <v-window-item value="motion">
            <v-btn @click="addCurve">Add motion curve</v-btn>
            <p>Base sound → snapshot → timeline → step locks → LFO/envelope modulation. Voice envelopes and discrete settings are captured at each attack.</p>
            <v-card v-for="(curve, i) in development.automation" :key="curve.id" variant="outlined" class="my-2 pa-3">
              <div class="studio-row"><v-select v-model="curve.target" :items="targetItems" label="Control" @update:model-value="curveTargetChanged(curve)" />
                <v-select v-model="curve.interpolation" :items="['linear','smooth','step']" label="Curve" @update:model-value="changed" />
                <v-select v-model="curve.clock" :items="definitions[curve.target]?.scope==='bus'?['song']:['song','note']" label="Clock" @update:model-value="changed" />
                <v-select v-if="track.trackKind==='rhythmic' && definitions[curve.target]?.scope==='voice'" :model-value="curve.lane" :items="laneItems" clearable label="Lane (optional)" @update:model-value="curve.lane=optionalNumber($event); changed()" />
                <v-btn icon="mdi-plus" @click="curve.points.push({beat:(curve.points.at(-1)?.beat ?? 0)+4,value:curve.points.at(-1)?.value ?? 0}); changed()" />
                <v-btn icon="mdi-delete" @click="development.automation.splice(i,1); changed()" /></div>
              <div v-for="(point,j) in curve.points" :key="j" class="studio-row">
                <v-text-field v-model.number="point.beat" label="Beat" type="number" @change="changed" />
                <v-select v-if="definitions[curve.target]?.options" v-model="point.value" :items="definitions[curve.target].options!.map(v=>({title:String(v),value:v}))" label="Value" @update:model-value="changed" />
                <v-text-field v-else v-model.number="point.value" label="Value" type="number" @change="changed" />
                <v-btn icon="mdi-delete" @click="curve.points.splice(j,1); changed()" /></div>
            </v-card>
            <v-select v-model="snapshotTargets" :items="targetItems" label="Settings to capture" multiple chips />
            <v-btn @click="captureSnapshot">Capture sound snapshot</v-btn>
            <div v-for="snapshot in development.snapshots" :key="snapshot.id" class="studio-row">
              <v-text-field v-model="snapshot.name" label="Snapshot name" @change="changed" />
              <v-btn @click="development.snapshotCues.push({beat:0,snapshot:snapshot.id,morphBeats:4}); changed()">Place on timeline</v-btn>
              <v-btn icon="mdi-delete" @click="development.snapshots = development.snapshots.filter(s=>s.id!==snapshot.id); development.snapshotCues=development.snapshotCues.filter(c=>c.snapshot!==snapshot.id); changed()" />
            </div>
            <div v-for="(cue,i) in development.snapshotCues" :key="i" class="studio-row">
              <v-select v-model="cue.snapshot" :items="development.snapshots.map(s=>({title:s.name,value:s.id}))" label="Snapshot" @update:model-value="if(!snapshotLaneAllowed(cue.snapshot))delete cue.lane; changed()" />
              <v-text-field v-model.number="cue.beat" label="Start beat" type="number" @change="changed" />
              <v-text-field v-model.number="cue.morphBeats" label="Morph beats" type="number" @change="changed" />
              <v-select v-if="track.trackKind==='rhythmic' && snapshotLaneAllowed(cue.snapshot)" :model-value="cue.lane" :items="laneItems" clearable label="Lane (optional)" @update:model-value="cue.lane=optionalNumber($event); changed()" />
              <v-btn icon="mdi-delete" @click="development.snapshotCues.splice(i,1); changed()" /></div>
          </v-window-item>
          <v-window-item value="returns">
            <v-btn @click="addReturn">Add dub return</v-btn><p>Track/lane sends enter the chain in listed order. Delay filtering and saturation act inside its feedback loop.</p>
            <v-card v-for="(aux,index) in studio.returns" :key="aux.id" variant="outlined" class="my-2 pa-3">
              <div class="studio-row"><v-text-field v-model="aux.name" label="Return" @change="studioChanged" /><v-text-field v-model.number="aux.level" type="number" label="Return level (dB)" @change="studioChanged" />
                <v-text-field :model-value="development.sends[aux.id] ?? -96" type="number" label="This track send (dB)" @update:model-value="development.sends[aux.id]=Number($event); changed()" />
                <v-btn icon="mdi-delete" @click="removeReturn(index)" /></div>
              <v-expansion-panels v-if="track.trackKind==='rhythmic'"><v-expansion-panel title="Individual lane sends"><v-expansion-panel-text>
                <div class="studio-row"><v-text-field v-for="(lane,n) in track.drumLanes" :key="n" :model-value="laneSend(aux.id,n)" type="number" :label="`${lane.voiceId} send (dB)`" @update:model-value="setLaneSend(aux.id,n,Number($event))" /></div>
                <p>Lane sends are song curves starting at beat 0. Edit their development in Motion.</p>
              </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
              <div v-for="(processor,i) in aux.chain" :key="processor.id" class="studio-row">
                <span>{{ processor.type }}</span>
                <template v-for="(value,key) in processor" :key="key"><template v-if="key !== 'id' && key !== 'type'">
                  <v-text-field v-if="typeof value === 'number'" :model-value="value" type="number" :label="String(key)" @update:model-value="setProcessor(processor,String(key),$event)" />
                  <v-select v-else :model-value="value" :items="processor.type === 'delay' ? ['stereo','mono','ping-pong'] : ['lowpass','highpass']" :label="String(key)" @update:model-value="setProcessor(processor,String(key),$event)" />
                </template></template>
                <v-btn :disabled="i===0" icon="mdi-arrow-up" @click="[aux.chain[i-1],aux.chain[i]]=[aux.chain[i],aux.chain[i-1]]; studioChanged()" />
                <v-btn icon="mdi-delete" @click="aux.chain.splice(i,1); studioChanged()" /></div>
              <div class="studio-row"><v-select v-model="processorType" :items="['delay','filter','saturation','gain']" label="Processing" /><v-btn @click="addProcessor(aux)">Add processor</v-btn></div>
              <v-expansion-panels><v-expansion-panel title="Return motion"><v-expansion-panel-text>
                <v-btn @click="aux.automation.push({id:uid('curve'),target:'level',interpolation:'smooth',points:[{beat:0,value:aux.level},{beat:16,value:aux.level}]}); studioChanged()">Add curve</v-btn>
                <div v-for="(curve,i) in aux.automation" :key="curve.id">
                  <div class="studio-row"><v-select v-model="curve.target" :items="returnTargets(aux)" label="Return control" @update:model-value="studioChanged" /><v-select v-model="curve.interpolation" :items="['linear','smooth','step']" label="Curve" @update:model-value="studioChanged" /><v-btn icon="mdi-delete" @click="aux.automation.splice(i,1); studioChanged()" /></div>
                  <v-btn @click="curve.points.push({beat:(curve.points.at(-1)?.beat ?? 0)+4,value:curve.points.at(-1)?.value ?? aux.level}); studioChanged()">Add point</v-btn>
                  <div v-for="(point,j) in curve.points" :key="j" class="studio-row"><v-text-field v-model.number="point.beat" label="Beat" type="number" @change="studioChanged" /><v-select v-if="curve.target.endsWith('.mode')" :model-value="typeof point.value==='string'?point.value:undefined" :items="returnModes(aux,curve.target)" label="Mode" @update:model-value="point.value=$event; studioChanged()" /><v-text-field v-else v-model.number="point.value" label="Value" type="number" @change="studioChanged" /><v-btn icon="mdi-delete" @click="curve.points.splice(j,1); studioChanged()" /></div>
                </div>
              </v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
            </v-card>
          </v-window-item>
          <v-window-item value="samples">
            <p>Import mono/stereo WAV: PCM 8/16/24/32-bit or float 32/64-bit. Portable exports include the audio.</p>
            <input type="file" accept=".wav,audio/wav" multiple aria-label="Import samples" @change="importSamples" />
            <p>{{ studio.assets.length }} sample assets</p><v-btn :disabled="!studio.assets.length" @click="addSampleSource">Add sample voice</v-btn>
            <v-card v-for="(source,index) in development.samples" :key="index" class="my-2 pa-3" variant="outlined">
              <div class="studio-row"><v-select v-if="track.trackKind === 'rhythmic'" v-model="source.lane" :items="laneItems" label="Replace drum lane" @update:model-value="changed" />
                <v-select v-model="source.selection" :items="['round-robin','random']" label="Alternatives" @update:model-value="changed" /><v-select v-model="source.mode" :items="['one-shot','loop']" label="Playback" @update:model-value="changed" />
                <v-btn icon="mdi-delete" @click="development.samples.splice(index,1); changed()" /></div>
              <div class="studio-row"><v-text-field v-model.number="source.start" label="Start seconds" type="number" @change="changed" /><v-text-field :model-value="source.end" label="End seconds (optional)" type="number" @update:model-value="source.end=optionalNumber($event); changed()" />
                <v-text-field v-model.number="source.gain" label="Gain dB" type="number" @change="changed" /><v-text-field v-model.number="source.rootNote" label="Root MIDI note" type="number" @change="changed" /><v-text-field v-model.number="source.tune" label="Tune semitones" type="number" @change="changed" />
                <v-text-field v-model.number="source.attack" label="Attack seconds" type="number" @change="changed" /><v-text-field v-model.number="source.release" label="Release seconds" type="number" @change="changed" /></div>
              <div v-for="(alternative,i) in source.alternatives" :key="i" class="studio-row"><v-select v-model="alternative.asset" :items="assetItems" label="Sample" @update:model-value="changed" />
                <v-text-field v-model.number="alternative.minVelocity" label="Min velocity" type="number" @change="changed" /><v-text-field v-model.number="alternative.maxVelocity" label="Max velocity" type="number" @change="changed" /><v-btn icon="mdi-delete" @click="source.alternatives.splice(i,1); changed()" /></div>
              <v-btn @click="source.alternatives.push({asset:studio.assets[0].hash,minVelocity:0,maxVelocity:1}); changed()">Add alternative</v-btn>
            </v-card>
          </v-window-item>
          <v-window-item value="render">
            <div class="studio-row"><v-checkbox v-model="includeLanes" label="Include drum sources" hide-details /><v-checkbox v-model="includePre" label="Include sources before inserts" hide-details /></div>
            <v-switch v-model="excerpt" label="Selected range" hide-details /><div v-if="excerpt" class="studio-row"><v-text-field v-model.number="rangeStart" label="Start (zero-based)" type="number" /><v-text-field v-model.number="rangeEnd" label="Exclusive end" type="number" /><v-select v-model="rangeUnit" :items="['bars','beats','seconds']" label="Unit" /></div>
            <div class="studio-row"><v-btn :disabled="busy || !validation.valid" @click="render('mix')">Export WAV</v-btn><v-btn :disabled="busy || !validation.valid" @click="render('stems')">Export stems</v-btn><v-select v-model="bounceSource" :items="bounceItems" label="Bounce source" /><v-btn :disabled="busy || !validation.valid" @click="render('bounce')">Bounce to sample</v-btn><v-btn @click="exportPackage">Portable project</v-btn><v-btn @click="copyShare">Share URL</v-btn><v-btn v-if="busy" @click="controller?.abort()">Cancel</v-btn></div>
            <p>{{ status }}</p>
            <audio v-if="preview" :src="preview" controls />
          </v-window-item>
        </v-window>
        <v-alert v-if="error" type="error" class="my-2">{{ error }}</v-alert>
        <v-alert v-for="diagnostic in validation.diagnostics.filter(d=>d.severity==='error').slice(0,6)" :key="diagnostic.path" type="warning" class="my-1">{{ diagnostic.path }}: {{ diagnostic.message }}</v-alert>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { clonePresetData, type PresetData } from '../presets';
import { normalizeDevelopment, normalizeStudio, parameterDefinitions, type ControlValue, type StepControl, type AuxiliaryReturn, type ReturnProcessor, type Automation } from '../domain/development';
import { validateProject } from '../domain/projectValidation';
import { createSampleAsset, importWavAsset } from '../audio/sampleAssets';
import { renderBrowserDevelopment } from '../audio/browserDevelopment';
import { encodeWavInWorker } from '../audio/wavWorker';
import { RENDERER_VERSION } from '../audio/renderCache';
import type { RenderRange } from '../audio/developmentRender';
const props = defineProps<{ project: PresetData; trackId: string | null }>();
const emit = defineEmits<{ 'update:project': [project: PresetData] }>();
const draft = ref(clonePresetData(props.project)), fallbackDevelopment = ref(normalizeDevelopment({})!), fallbackStudio = ref(normalizeStudio({})!);
watch(() => props.project, value => { draft.value = clonePresetData(value); if(!value.studio)fallbackStudio.value=normalizeStudio({})!; }, { deep: true });
watch(()=>props.trackId,()=>{fallbackDevelopment.value=normalizeDevelopment({})!;stepPattern.value='';lockTarget.value='';snapshotTargets.value=['filterFrequency','filterQ','gain'];});
const track = computed(() => draft.value.tracks.find(t => t.id === props.trackId) ?? draft.value.tracks[0]);
const development = computed(() => track.value.development ?? fallbackDevelopment.value), studio = computed(() => draft.value.studio ?? fallbackStudio.value);
const tab = ref('phrases'), stepPattern = ref(''), lockTarget = ref(''), processorType = ref('delay'), snapshotTargets = ref(['filterFrequency','filterQ','gain']);
const excerpt = ref(false), rangeStart = ref(0), rangeEnd = ref(4), rangeUnit = ref<RenderRange['unit']>('bars'), bounceSource = ref('mix');
const busy = ref(false), status = ref(''), error = ref(''), preview = ref(''), controller = ref<AbortController>();
const includeLanes=ref(true),includePre=ref(true);
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const definitions = computed(() => parameterDefinitions(track.value.drumLanes, studio.value.returns.map(a => a.id),track.value.trackKind));
const targetItems = computed(() => Object.entries(definitions.value).map(([value, definition]) => ({ value, title: definition.label + (value.startsWith('lane.') ? ` · lane ${value.split('.')[1]}` : '') })));
const voiceTargets = computed(() => targetItems.value.filter(item => definitions.value[item.value].scope === 'voice'));
const patternItems = computed(() => development.value.patterns.map(p => ({ title: p.name, value: p.id })));
const laneItems = computed(() => track.value.drumLanes.map((l,i) => ({ title: `${i} · ${l.voiceId}`, value:i })));
const assetItems = computed(() => studio.value.assets.map(a => ({ title: a.name, value: a.hash })));
const activeSteps = computed(() => development.value.patterns.find(p => p.id === stepPattern.value)?.steps ?? development.value.steps);
const validation = computed(() => validateProject(draft.value));
const bounceItems = computed(() => [{title:'Mix',value:'mix'}, ...draft.value.tracks.map(t=>({title:t.name,value:t.id})), ...studio.value.returns.map(a=>({title:a.name,value:a.id}))]);
const optionalNumber = (value: unknown) => value === '' || value === null || value === undefined ? undefined : Number(value);
function changed() { track.value.development = normalizeDevelopment(development.value); emit('update:project', clonePresetData(draft.value)); }
function studioChanged() { draft.value.studio = normalizeStudio(studio.value); emit('update:project', clonePresetData(draft.value)); }
function capturePattern() { development.value.patterns.push({ id:uid('phrase'), name:`Phrase ${development.value.patterns.length+1}`, sequence:track.value.sequenceInput, steps:[] }); changed(); }
function removePattern(id:string) { development.value.patterns = development.value.patterns.filter(p=>p.id!==id); development.value.sections=development.value.sections.filter(s=>s.pattern!==id); development.value.sections.forEach(s=>{s.choices=s.choices?.filter(c=>c.pattern!==id);}); if(stepPattern.value===id)stepPattern.value=''; changed(); }
function addSection() { development.value.sections.push({id:uid('section'),name:'Main',pattern:development.value.patterns[0].id,length:4,unit:'bars',boundary:'cut'}); changed(); }
function moveSection(index:number) { const sections=development.value.sections; [sections[index-1],sections[index]]=[sections[index],sections[index-1]]; changed(); }
function addStep() { const pattern = development.value.patterns.find(p=>p.id===stepPattern.value); if(pattern) pattern.steps ??= []; (pattern?.steps ?? development.value.steps).push({step:0,gate:1,offsetBeats:0,condition:{},locks:{}}); changed(); }
function baseValue(target:string):ControlValue { if(target.startsWith('send.')) return development.value.sends[target.slice(5)] ?? -96;
  if(target.startsWith('modulation.')) return 0;
  if(target.startsWith('lane.')) { const [,lane,key]=target.split('.'); return track.value.drumLanes[Number(lane)].parameters[key]; }
  return (track.value as unknown as Record<string,ControlValue>)[target]; }
function addLock(step:StepControl) { step.locks ??= {}; step.locks[lockTarget.value]=baseValue(lockTarget.value); changed(); }
function addCurve() { development.value.automation.push({id:uid('motion'),target:'filterFrequency',interpolation:'smooth',clock:'song',points:[{beat:0,value:track.value.filterFrequency},{beat:16,value:track.value.filterFrequency}]}); changed(); }
function curveTargetChanged(curve:Automation) {
  const definition=definitions.value[curve.target];
  if(definition?.scope==='bus'){curve.clock='song';delete curve.lane;}
  if(definition?.options)curve.interpolation='step';
  changed();
}
function snapshotLaneAllowed(id:string) { return Object.keys(development.value.snapshots.find(s=>s.id===id)?.values ?? {}).every(target=>definitions.value[target]?.scope==='voice'); }
function captureSnapshot() { development.value.snapshots.push({id:uid('sound'),name:`Sound ${development.value.snapshots.length+1}`,values:Object.fromEntries(snapshotTargets.value.map(target=>[target,baseValue(target)]))}); changed(); }
function addReturn() { studio.value.returns.push({id:uid('dub'),name:'Dub echo',level:-12,chain:[{id:uid('delay'),type:'delay',beats:0.75,feedback:0.5,cutoff:5000,drive:6,mode:'ping-pong'}],automation:[]}); studioChanged(); }
function laneSend(id:string,lane:number) {return development.value.automation.find(c=>c.target===`send.${id}`&&c.lane===lane)?.points[0]?.value ?? development.value.sends[id] ?? -96;}
function setLaneSend(id:string,lane:number,value:number) {const existing=development.value.automation.find(c=>c.target===`send.${id}`&&c.lane===lane);if(existing)existing.points[0]={beat:0,value};else development.value.automation.push({id:uid('send'),target:`send.${id}`,lane,clock:'song',interpolation:'step',points:[{beat:0,value}]});changed();}
function addProcessor(aux:AuxiliaryReturn) { const id=uid('effect'); const p:ReturnProcessor=processorType.value==='delay'?{id,type:'delay',beats:0.75,feedback:0.4,cutoff:5000,drive:6,mode:'stereo'}:processorType.value==='filter'?{id,type:'filter',frequency:4000,mode:'lowpass'}:processorType.value==='gain'?{id,type:'gain',gain:0}:{id,type:'saturation',drive:6}; aux.chain.push(p); studioChanged(); }
function setProcessor(processor:ReturnProcessor,key:string,value:unknown) { (processor as unknown as Record<string,unknown>)[key]=typeof (processor as unknown as Record<string,unknown>)[key]==='number'?Number(value):value; studioChanged(); }
function returnTargets(aux:AuxiliaryReturn) { return ['level',...aux.chain.flatMap(p=>Object.keys(p).filter(k=>!['id','type'].includes(k)).map(k=>`${p.id}.${k}`))]; }
function returnModes(aux:AuxiliaryReturn,target:string){return aux.chain.find(p=>target===`${p.id}.mode`)?.type==='delay'?['mono','stereo','ping-pong']:['lowpass','highpass'];}
function removeReturn(index:number) { const id=studio.value.returns[index].id; studio.value.returns.splice(index,1); draft.value.tracks.forEach(t=>{ if(t.development){const d=t.development;delete d.sends[id];d.automation=d.automation.filter(c=>c.target!==`send.${id}`);d.snapshots.forEach(s=>delete s.values[`send.${id}`]);[...d.steps,...d.patterns.flatMap(p=>p.steps ?? [])].forEach(s=>{if(s.locks)delete s.locks[`send.${id}`];});d.patterns.forEach(p=>{if(p.overrides)delete p.overrides[`send.${id}`];});} }); studioChanged(); }
async function importSamples(event:Event) { error.value=''; try { const files=(event.target as HTMLInputElement).files; for(const file of Array.from(files ?? [])) { const asset=await importWavAsset(new Uint8Array(await file.arrayBuffer()),file.name); if(!studio.value.assets.some(a=>a.hash===asset.hash)) studio.value.assets.push(asset); } studioChanged(); } catch(e){error.value=String(e);} }
function addSampleSource() { development.value.samples.push({alternatives:[{asset:studio.value.assets[0].hash,minVelocity:0,maxVelocity:1}],selection:'round-robin',start:0,gain:0,rootNote:60,tune:0,attack:0.002,release:0.03,mode:'one-shot',...(track.value.trackKind==='rhythmic'?{lane:0}:{})}); changed(); }
function download(bytes:Uint8Array,name:string,type:string) { const url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
function exportPackage() { download(new TextEncoder().encode(JSON.stringify({type:'gaterunner-asset-package',version:1,project:draft.value})), 'GateRunner-project.grproject.json','application/json'); }
async function copyShare() { try { const url=new URL(location.href); url.search=''; url.searchParams.set('project',JSON.stringify(draft.value)); await navigator.clipboard.writeText(url.toString()); status.value='Project URL copied. Large samples are better shared as a portable project.'; } catch(e){error.value=String(e);} }
async function render(mode:'mix'|'stems'|'bounce') { busy.value=true; error.value=''; controller.value=new AbortController(); try {
  const result=await renderBrowserDevelopment(draft.value,{range:excerpt.value?{start:rangeStart.value,end:rangeEnd.value,unit:rangeUnit.value}:undefined, laneStems:mode==='stems'&&includeLanes.value,preInsertStems:mode==='stems'&&includePre.value,signal:controller.value.signal,onProgress:p=>{status.value=`${p.completed}/${p.total} · ${p.stage}`;}});
  const bytes=await encodeWavInWorker(result.channels,result.sampleRate,{signal:controller.value.signal}); if(preview.value) URL.revokeObjectURL(preview.value); preview.value=URL.createObjectURL(new Blob([bytes.slice().buffer],{type:'audio/wav'}));
  if(mode==='mix') download(bytes,'GateRunner-range.wav','audio/wav');
  if(mode==='stems') { const manifest=[]; for(const stem of result.stems){status.value=`Encoding ${stem.name}`;const file=`${stem.id}.wav`; download(await encodeWavInWorker(stem.channels,result.sampleRate,{signal:controller.value.signal,format:'float32'}),file,'audio/wav'); manifest.push({file,id:stem.id,stage:stem.stage,recombine:stem.recombine});} download(new TextEncoder().encode(JSON.stringify({range:result.range,sampleRate:result.sampleRate,format:'float32',masterGain:draft.value.masterGain,instructions:'Sum recombine=true stems, then apply GateRunner master once.',files:manifest},null,2)),'stems.json','application/json'); }
  if(mode==='bounce') { const channels=bounceSource.value==='mix'?result.channels:result.stems.find(s=>s.id===bounceSource.value)?.channels; if(!channels) throw new Error('Choose an existing bounce source'); const asset=await createSampleAsset(channels,result.sampleRate,`Bounce ${studio.value.assets.length+1}`,{project:clonePresetData(draft.value),range:result.range,renderer:RENDERER_VERSION,sampleRate:result.sampleRate,source:bounceSource.value}); if(!studio.value.assets.some(a=>a.hash===asset.hash))studio.value.assets.push(asset); studioChanged(); }
  status.value=`${result.measurements.duration.toFixed(2)} s · peak ${result.measurements.peak.toFixed(3)} · RMS ${result.measurements.rms.toFixed(3)} · ${(result.stats.milliseconds/1000).toFixed(2)} s render · ${result.stats.cacheHits} cached tracks`;
}catch(e){error.value=controller.value.signal.aborted?'Render cancelled':String(e);}finally{busy.value=false;} }
</script>
<style scoped>
.development-panel { margin: 12px auto; max-width: 1200px; }
.studio-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:8px; }
.studio-row > :deep(.v-input) { min-width:140px; flex:1; }
.studio-section { border:1px solid rgba(128,128,128,.3); padding:12px; margin:12px 0; border-radius:8px; }
</style>
