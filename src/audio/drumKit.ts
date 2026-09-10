import * as Tone from 'tone';
import {
  getDefaultDrumParameters,
  normalizeDrumParameters,
  type DrumParameterBag,
  type DrumParameterValue,
  type DrumVoiceId,
} from '../domain/rhythmTrack.js';

export interface DrumInstrument {
  node: any;
  filter: Tone.Filter;
  preGain: Tone.Gain;
  echoSend: Tone.Gain;
  reverbSend: Tone.Gain;
  voice?: any;
  voice2?: any;
  voice3?: any;
  live?: Record<string, number>;
  trigger(time: number, velocity: number, duration?: number): void;
  choke(time: number): void;
  update?(parameters: DrumParameterBag): boolean;
  dispose(): void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sendLevelToGain(value: DrumParameterValue): number {
  const decibels = Number(value);
  return decibels <= -96 ? 0 : Tone.dbToGain(decibels);
}

function powerWaveShaperSample(value: number, drive: number, power: number): number {
  const scaled = value * (1 + Math.max(0, drive) * 12);
  const exponent = Math.max(0.15, Math.min(16, power));
  const magnitude = Math.abs(scaled);
  if (magnitude < 1e-12) {
    return 0;
  }
  return Math.sign(scaled) * (magnitude / Math.pow(1 + Math.pow(magnitude, exponent), 1 / exponent));
}

function buildPowerWaveShaperCurve(drive: number, power: number, size = 2048): Float32Array {
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    curve[index] = powerWaveShaperSample((index / (size - 1)) * 2 - 1, drive, power);
  }
  return curve;
}

function schedulePowerCurve(
  parameter: any,
  time: number,
  from: number,
  to: number,
  duration: number,
  shape: number,
  segments = 24,
): void {
  const safeDuration = Math.max(0.001, duration);
  const exponent = Math.max(0.05, Math.min(12, shape));
  const safeSegments = Math.max(4, Math.min(64, Math.trunc(segments)));
  try {
    parameter.cancelScheduledValues?.(time);
    parameter.setValueAtTime?.(from, time);
    for (let index = 1; index <= safeSegments; index += 1) {
      const normalized = index / safeSegments;
      const eased = 1 - Math.pow(1 - normalized, exponent);
      parameter.linearRampToValueAtTime?.(from + (to - from) * eased, time + safeDuration * normalized);
    }
  } catch {
    // Audio parameter scheduling can fail while an OfflineContext is being torn down.
  }
}

function safeDispose(value: any): void {
  try {
    value?.stop?.();
  } catch {
    // A source may already be stopped.
  }
  try {
    value?.dispose?.();
  } catch {
    // A dependent node may already have disposed this resource.
  }
}

function register(owned: any[], ...nodes: any[]): void {
  owned.push(...nodes.filter(Boolean));
}

interface TriggerVoice {
  connect(destination: any): unknown;
  triggerAttackRelease(...args: any[]): unknown;
  triggerRelease?(time?: any): unknown;
  dispose?(): unknown;
}

interface PooledVoice<T extends TriggerVoice> {
  voice: T;
  availableAt: number;
  lastStartAt: number;
}

/** Per-layer polyphony ceiling for a single GM drum voice. */
const MAX_POOLED_DRUM_VOICES = 1;

/** Matches Tone's source timeline epsilon for strictly ordered restarts. */
const MIN_POOLED_VOICE_RESTART_INTERVAL_SECONDS = 1e-6;

/**
 * Tone.MetalSynth keeps six FM oscillators plus their whole signal graph running for as
 * long as the instance exists, so an idle instance still costs render-thread time. Cymbal
 * layers therefore get a much tighter ceiling than the cheap oscillator/noise layers.
 */
const MAX_POOLED_METAL_VOICES = 1;

function timeToSeconds(value: Tone.Unit.Time): number {
  if (typeof value === 'number') {
    return value;
  }

  try {
    return Tone.Time(value).toSeconds();
  } catch {
    return 0;
  }
}

function createTriggeredVoicePool<T extends TriggerVoice>(
  createVoice: () => T,
  getBusyDuration: (durationSeconds: number) => number,
  owned: any[],
  maxVoices = MAX_POOLED_DRUM_VOICES,
): T {
  const voiceLimit = Math.max(1, Math.trunc(maxVoices));
  const voices: PooledVoice<T>[] = [];
  const destinations: any[] = [];
  const createAvailableVoice = (): PooledVoice<T> => {
    const voice = createVoice();
    register(owned, voice);
    destinations.forEach((destination) => voice.connect(destination));
    const entry = {
      voice,
      availableAt: Number.NEGATIVE_INFINITY,
      lastStartAt: Number.NEGATIVE_INFINITY,
    };
    voices.push(entry);
    return entry;
  };

  const pool = {
    connect(destination: any) {
      destinations.push(destination);
      voices.forEach(({ voice }) => voice.connect(destination));
      return pool;
    },
    triggerAttackRelease(...args: any[]) {
      const duration = args.length >= 4 ? args[1] : args[0];
      const time = args.length >= 4 ? args[2] : args[1];
      const startSeconds = timeToSeconds(time);
      const durationSeconds = Math.max(0, timeToSeconds(duration));
      let selected = voices.find((candidate) => (
        candidate.availableAt <= startSeconds
          && startSeconds > candidate.lastStartAt + MIN_POOLED_VOICE_RESTART_INTERVAL_SECONDS
      ));
      if (!selected) {
        if (voices.length < voiceLimit) {
          selected = createAvailableVoice();
        } else {
          // Dense patterns with long tails would otherwise grow the pool without bound
          // until the audio thread can no longer render in realtime; steal instead.
          selected = voices.reduce((oldest, candidate) => (
            candidate.lastStartAt < oldest.lastStartAt ? candidate : oldest
          ));
          if (!(startSeconds > selected.lastStartAt + MIN_POOLED_VOICE_RESTART_INTERVAL_SECONDS)) {
            return pool;
          }
        }
      }
      selected.voice.triggerAttackRelease(...args);
      selected.availableAt = startSeconds + Math.max(0.001, getBusyDuration(durationSeconds));
      selected.lastStartAt = startSeconds;
      return pool;
    },
    triggerRelease(time: Tone.Unit.Time) {
      const releaseSeconds = timeToSeconds(time);
      voices.forEach((entry) => {
        if (entry.availableAt > releaseSeconds) {
          entry.voice.triggerRelease?.(time);
          entry.availableAt = Math.max(entry.availableAt, releaseSeconds + 0.001);
        }
      });
      return pool;
    },
  };

  return pool as T;
}

function keepMetalOscillatorsRunning(metal: Tone.MetalSynth): void {
  if (!metal.context.isOffline) {
    return;
  }

  const internals = metal as unknown as {
    envelope: Tone.Envelope;
    _triggerEnvelopeRelease: (time: number) => unknown;
  };
  internals.envelope.sustain = 1e-6;
  internals._triggerEnvelopeRelease = (time: number) => {
    internals.envelope.triggerRelease(time);
    return metal;
  };
}

export function createDrumInstrument(voiceId: DrumVoiceId, rawParameters: DrumParameterBag = {}): DrumInstrument {
  const parameters = normalizeDrumParameters(voiceId, {
    ...getDefaultDrumParameters(voiceId),
    ...rawParameters,
  });
  const owned: any[] = [];
  const inputGain = new Tone.Gain(Tone.dbToGain(Number(parameters.distortionInputGain ?? 0)));
  const distortion = new Tone.Distortion(1);
  const filter = new Tone.Filter({
    frequency: Number(parameters.filterFrequency ?? 20000),
    type: String(parameters.filterType ?? 'lowpass') as BiquadFilterType,
    Q: Number(parameters.filterResonance ?? 1),
    rolloff: Number(parameters.filterRolloff ?? -12) as any,
    gain: Number(parameters.filterGain ?? 0),
  });
  const postVca = new Tone.Gain(1);
  const echoSend = new Tone.Gain(sendLevelToGain(parameters.echoSend ?? -96));
  const reverbSend = new Tone.Gain(sendLevelToGain(parameters.reverbSend ?? -96));
  register(owned, inputGain, distortion, filter, postVca, echoSend, reverbSend);
  inputGain.connect(distortion);
  distortion.connect(filter);
  filter.connect(postVca);

  const scheduleVelocityEnvelope = (time: number, velocity: number, envelopeDuration: number): void => {
    try {
      const gain = (postVca as any).gain;
      gain.cancelScheduledValues?.(time);
      gain.setValueAtTime?.(clamp(velocity, 0, 1), time);
      gain.linearRampToValueAtTime?.(1, time + Math.max(0.03, envelopeDuration));
    } catch {
      // Ignore scheduling failures during context shutdown.
    }
  };

  const scheduleGainEnvelope = (parameter: any, start: number, peak: number, attack: number, decay: number): void => {
    try {
      const safeAttack = Math.max(0.0005, attack);
      const end = start + safeAttack + Math.max(0.004, decay);
      parameter.cancelScheduledValues?.(start);
      parameter.setValueAtTime?.(0, start);
      parameter.linearRampToValueAtTime?.(peak, start + safeAttack);
      parameter.linearRampToValueAtTime?.(0, end);
    } catch {
      // Ignore scheduling failures during context shutdown.
    }
  };

  let currentParameters = parameters;
  const finish = (instrument: Omit<DrumInstrument, 'dispose' | 'choke' | 'echoSend' | 'reverbSend'>): DrumInstrument => ({
    ...instrument,
    echoSend,
    reverbSend,
    update(nextParameters) {
      const next = normalizeDrumParameters(voiceId, nextParameters);
      echoSend.gain.value = sendLevelToGain(next.echoSend ?? -96);
      reverbSend.gain.value = sendLevelToGain(next.reverbSend ?? -96);
      const soundChanged = Object.entries(next).some(([name, value]) => (
        name !== 'echoSend' && name !== 'reverbSend' && currentParameters[name] !== value
      ));
      currentParameters = next;
      return soundChanged ? instrument.update?.(next) === true : true;
    },
    choke(time) {
      try {
        const gain = (postVca as any).gain;
        const current = typeof gain?.value === 'number' ? gain.value : 1;
        gain.cancelScheduledValues?.(time);
        gain.setValueAtTime?.(current, time);
        gain.linearRampToValueAtTime?.(0, time + 0.008);
      } catch {
        // Ignore scheduling failures during context shutdown.
      }
      for (const voice of [instrument.voice, instrument.voice2, instrument.voice3]) {
        try {
          voice?.triggerRelease?.(time);
        } catch {
          // A source may already be released or disposed.
        }
      }
    },
    dispose() {
      for (const node of [...owned].reverse()) {
        safeDispose(node);
      }
      owned.length = 0;
    },
  });

  switch (voiceId) {
    case 'kick': {
      const tune = clamp(Number(parameters.tune ?? 55), 20, 400);
      const sweepOctaves = Math.max(0, Number(parameters.sweep ?? 4));
      const sweepTime = Math.max(0.001, Number(parameters.sweepTime ?? 0.05));
      const pitchShape = Math.max(0.05, Number(parameters.pitchShape ?? 3));
      const bodyDecay = Math.max(0.01, Number(parameters.decay ?? 0.45));
      const ampShape = Math.max(0.05, Number(parameters.ampShape ?? 2));
      const drive = clamp(Number(parameters.drive ?? 0.35), 0, 1);
      const wavePower = Math.max(0.15, Number(parameters.wavePower ?? 2.5));
      const oscillator = new Tone.Oscillator({ type: 'sine', frequency: tune });
      const shaper = new Tone.WaveShaper(buildPowerWaveShaperCurve(drive, wavePower));
      const ampEnvelope = new Tone.Gain(0);
      register(owned, oscillator, shaper, ampEnvelope);
      oscillator.connect(shaper);
      shaper.connect(ampEnvelope);
      ampEnvelope.connect(inputGain);
      oscillator.start();

      const live = { tune, sweepOctaves, sweepTime, pitchShape, bodyDecay, ampShape, drive, wavePower };
      return finish({
        node: postVca,
        filter,
        preGain: inputGain,
        voice: oscillator,
        live,
        update(nextParameters) {
          const next = normalizeDrumParameters(voiceId, nextParameters);
          const nextDrive = clamp(Number(next.drive ?? live.drive), 0, 1);
          const nextWavePower = Math.max(0.15, Number(next.wavePower ?? live.wavePower));
          const shaperChanged = nextDrive !== live.drive || nextWavePower !== live.wavePower;
          const nextTune = Number(next.tune ?? live.tune);
          live.tune = Number.isFinite(nextTune) ? clamp(nextTune, 20, 400) : live.tune;
          live.sweepOctaves = Math.max(0, Number(next.sweep ?? live.sweepOctaves));
          live.sweepTime = Math.max(0.001, Number(next.sweepTime ?? live.sweepTime));
          live.pitchShape = Math.max(0.05, Number(next.pitchShape ?? live.pitchShape));
          live.bodyDecay = Math.max(0.01, Number(next.decay ?? live.bodyDecay));
          live.ampShape = Math.max(0.05, Number(next.ampShape ?? live.ampShape));
          live.drive = nextDrive;
          live.wavePower = nextWavePower;
          oscillator.frequency.value = live.tune;
          inputGain.gain.value = Tone.dbToGain(Number(next.distortionInputGain ?? 0));
          filter.set({
            type: String(next.filterType ?? 'lowpass') as BiquadFilterType,
            frequency: Number(next.filterFrequency ?? 20000),
            Q: Number(next.filterResonance ?? 1),
            rolloff: Number(next.filterRolloff ?? -12) as any,
            gain: Number(next.filterGain ?? 0),
          });
          if (shaperChanged) {
            try {
              shaper.curve = buildPowerWaveShaperCurve(live.drive, live.wavePower);
            } catch {
              // The curve may be unavailable while the audio context is closing.
            }
          }
          return true;
        },
        trigger(time, velocity, duration) {
          const pitchDuration = Math.max(0.001, live.sweepTime);
          const amplitudeDuration = Math.max(0.01, duration ?? live.bodyDecay);
          const peak = clamp(velocity, 0, 1);
          const startHz = Math.max(1, live.tune * Math.pow(2, live.sweepOctaves));
          scheduleVelocityEnvelope(time, peak, amplitudeDuration + 0.02);
          schedulePowerCurve((oscillator as any).frequency, time, startHz, live.tune, pitchDuration, live.pitchShape);
          const gain = (ampEnvelope as any).gain;
          try {
            gain.cancelScheduledValues?.(time);
            gain.setValueAtTime?.(0, time);
            gain.linearRampToValueAtTime?.(peak, time + 0.0015);
            schedulePowerCurve(gain, time + 0.0015, peak, 0, amplitudeDuration, live.ampShape);
          } catch {
            // Ignore scheduling failures during context shutdown.
          }
        },
      });
    }
    case 'snare': {
      const tune = Number(parameters.tune ?? 185);
      const toneDecay = Number(parameters.toneDecay ?? 0.12);
      const noiseType = ['white', 'pink', 'brown'].includes(String(parameters.noiseType)) ? String(parameters.noiseType) : 'white';
      const noiseDecay = Number(parameters.noiseDecay ?? 0.2);
      const snap = clamp(Number(parameters.snap ?? 0.7), 0, 1);
      const mix = clamp(Number(parameters.mix ?? 0.5), 0, 1);
      const tone = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'triangle' } as any, envelope: { attack: 0.001, decay: toneDecay, sustain: 0, release: toneDecay * 0.3 } }),
        (duration) => Math.max(0.001 + toneDecay, duration + toneDecay * 0.3),
        owned,
      );
      const noise = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({ noise: { type: noiseType as any }, envelope: { attack: 0.002, decay: noiseDecay, sustain: 0, release: noiseDecay * 0.25 } }),
        (duration) => Math.max(noiseDecay + 0.002, duration + noiseDecay * 0.25),
        owned,
      );
      const snapSynth = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({ noise: { type: 'white' as any }, envelope: { attack: 0.0005, decay: 0.015, sustain: 0, release: 0.005 } }),
        (duration) => Math.max(0.0155, duration + 0.005),
        owned,
      );
      const toneGain = new Tone.Gain(1 - mix);
      const noiseGain = new Tone.Gain(mix);
      const snapGain = new Tone.Gain(snap);
      register(owned, tone, toneGain, noiseGain, snapGain);
      tone.connect(toneGain).connect(inputGain);
      noise.connect(noiseGain).connect(inputGain);
      snapSynth.connect(snapGain).connect(inputGain);
      const live = { tune, snap };
      return finish({
        node: postVca, filter, preGain: inputGain, voice: tone, voice2: noise, voice3: snapSynth, live,
        trigger(time, velocity, duration) {
          const naturalDuration = Math.max(toneDecay, noiseDecay) + 0.05;
          const safeDuration = Math.max(naturalDuration, duration ?? 0.2);
          scheduleVelocityEnvelope(time, velocity, naturalDuration);
          tone.triggerAttackRelease(live.tune, toneDecay * 1.3, time, velocity);
          noise.triggerAttackRelease(safeDuration, time, velocity);
          if (live.snap > 0.01) snapSynth.triggerAttackRelease(0.02, time, velocity * live.snap);
        },
      });
    }
    case 'clap': {
      const color = Math.max(700, Number(parameters.tune ?? 1600));
      const burstDecay = Number(parameters.toneDecay ?? 0.03);
      const noiseType = ['white', 'pink', 'brown'].includes(String(parameters.noiseType)) ? String(parameters.noiseType) : 'pink';
      const tailDecay = Number(parameters.noiseDecay ?? 0.24);
      const snap = clamp(Number(parameters.snap ?? 0.85), 0, 1);
      const mix = clamp(Number(parameters.mix ?? 0.55), 0, 1);
      const body = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({
          noise: { type: noiseType as any },
          envelope: { attack: 0.0006, decay: burstDecay, sustain: 0, release: burstDecay * 0.35 },
        }),
        (duration) => Math.max(0.0006 + burstDecay, duration + burstDecay * 0.35),
        owned,
      );
      const tail = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({
          noise: { type: noiseType as any },
          envelope: { attack: 0.0025, decay: tailDecay, sustain: 0, release: tailDecay * 0.35 },
        }),
        (duration) => Math.max(0.0025 + tailDecay, duration + tailDecay * 0.35),
        owned,
      );
      const snapSynth = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({
          noise: { type: 'white' as any },
          envelope: { attack: 0.0002, decay: 0.005, sustain: 0, release: 0.002 },
        }),
        (duration) => Math.max(0.0052, duration + 0.002),
        owned,
      );
      const toneFilter = new Tone.Filter({ type: 'bandpass', frequency: color, Q: 1.35 });
      const noiseFilter = new Tone.Filter({ type: 'highpass', frequency: Math.max(1400, color * 1.5), Q: 0.8 });
      const snapFilter = new Tone.Filter({ type: 'highpass', frequency: Math.max(3200, color * 2.3), Q: 0.7 });
      register(owned, toneFilter, noiseFilter, snapFilter);
      body.connect(toneFilter).connect(inputGain);
      tail.connect(noiseFilter).connect(inputGain);
      snapSynth.connect(snapFilter).connect(inputGain);
      const burstOffsets = [0, 0.012, 0.024, 0.041];
      return finish({
        node: postVca, filter, preGain: inputGain, voice: body, voice2: tail, voice3: snapSynth,
        trigger(time, velocity, duration) {
          const naturalDuration = burstOffsets[burstOffsets.length - 1] + tailDecay + 0.04;
          const safeDuration = Math.max(naturalDuration, duration ?? 0.18);
          const bodyLevel = velocity * (0.35 + (1 - mix) * 0.55);
          const tailLevel = velocity * (0.18 + mix * 0.85);
          const transientLevel = velocity * snap;
          scheduleVelocityEnvelope(time, velocity, safeDuration);
          burstOffsets.forEach((offset, index) => {
            body.triggerAttackRelease(
              Math.max(0.004, burstDecay * (1 + index * 0.22)),
              time + offset,
              bodyLevel * (1 - index * 0.16),
            );
            snapSynth.triggerAttackRelease(
              0.006 + index * 0.0015,
              time + offset,
              transientLevel * (1 - index * 0.14),
            );
          });
          tail.triggerAttackRelease(Math.max(0.02, tailDecay), time + 0.016, tailLevel);
        },
      });
    }
    case 'hat':
    case 'hatPedal':
    case 'hatOpen': {
      const tune = Number(parameters.tune ?? 300);
      const decay = Number(parameters.decay ?? 0.08);
      const metal = createTriggeredVoicePool(
        () => {
          const voice = new Tone.MetalSynth({
            envelope: { attack: 0.001, decay, release: decay * 0.3 },
            harmonicity: Number(parameters.harmonicity ?? 5.1),
            modulationIndex: Number(parameters.modIndex ?? 32),
            resonance: Number(parameters.brightness ?? 8000),
            octaves: 1.5,
          });
          keepMetalOscillatorsRunning(voice);
          return voice;
        },
        (duration) => duration + decay * 0.3,
        owned,
        MAX_POOLED_METAL_VOICES,
      );
      metal.connect(inputGain);
      const live = { tune };
      return finish({
        node: postVca, filter, preGain: inputGain, voice: metal, live,
        trigger(time, velocity, duration) {
          const safeDuration = Math.max(decay * 1.3, duration ?? 0.08);
          scheduleVelocityEnvelope(time, velocity, decay + 0.02);
          metal.triggerAttackRelease(live.tune, safeDuration, time, velocity);
        },
      });
    }
    case 'crash':
    case 'chineseCymbal':
    case 'splash':
    case 'crash2': {
      const tune = Number(parameters.tune ?? 220);
      const decay = Number(parameters.decay ?? 1.4);
      const brightness = Number(parameters.brightness ?? 12000);
      const wash = clamp(Number(parameters.wash ?? 0.65), 0, 1);
      const metal = createTriggeredVoicePool(
        () => {
          const voice = new Tone.MetalSynth({
            envelope: { attack: 0.001, decay, release: decay * 0.7 },
            harmonicity: Number(parameters.harmonicity ?? 2.2),
            modulationIndex: Number(parameters.modIndex ?? 55),
            resonance: brightness,
            octaves: 2,
          });
          keepMetalOscillatorsRunning(voice);
          return voice;
        },
        (duration) => duration + decay * 0.7,
        owned,
        MAX_POOLED_METAL_VOICES,
      );
      const washDecay = Math.max(0.3, decay * 1.15);
      const washRelease = Math.max(0.12, decay * 0.45);
      const washNoise = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({ noise: { type: 'white' as any }, envelope: { attack: 0.002, decay: washDecay, sustain: 0, release: washRelease } }),
        (duration) => Math.max(0.002 + washDecay, duration + washRelease),
        owned,
      );
      const noiseFilter = new Tone.Filter({ type: 'highpass', frequency: Math.max(2200, brightness * 0.35), Q: 0.8 });
      const noiseGain = new Tone.Gain(wash);
      register(owned, noiseFilter, noiseGain);
      metal.connect(inputGain);
      washNoise.connect(noiseFilter).connect(noiseGain).connect(inputGain);
      const live = { tune, wash };
      return finish({
        node: postVca, filter, preGain: inputGain, voice: metal, voice2: washNoise, live,
        trigger(time, velocity, duration) {
          const naturalDuration = decay * 1.7;
          const safeDuration = Math.max(naturalDuration, duration ?? decay * 1.15);
          scheduleVelocityEnvelope(time, velocity, naturalDuration + 0.05);
          metal.triggerAttackRelease(live.tune, safeDuration, time, velocity);
          if (live.wash > 0.01) washNoise.triggerAttackRelease(Math.max(0.4, decay * 1.1), time, velocity * live.wash);
        },
      });
    }
    case 'rimshot': {
      const tune = Number(parameters.tune ?? 260);
      const decay = Number(parameters.decay ?? 0.09);
      const snap = clamp(Number(parameters.snap ?? 0.9), 0, 1);
      const low = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.0005, decay, sustain: 0, release: 0.015 } }),
        (duration) => Math.max(0.0005 + decay, duration + 0.015),
        owned,
      );
      const high = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.0005, decay: decay * 0.52, sustain: 0, release: 0.008 } }),
        (duration) => Math.max(0.0005 + decay * 0.52, duration + 0.008),
        owned,
      );
      const stick = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({ noise: { type: 'white' as any }, envelope: { attack: 0.0002, decay: 0.008, sustain: 0, release: 0.003 } }),
        (duration) => Math.max(0.0082, duration + 0.003),
        owned,
      );
      const toneGain = new Tone.Gain(0.68);
      const noiseGain = new Tone.Gain(snap);
      const snapFilter = new Tone.Filter({ type: 'bandpass', frequency: Number(parameters.color ?? 4800), Q: 2.8 });
      register(owned, toneGain, noiseGain, snapFilter);
      low.connect(toneGain);
      high.connect(toneGain).connect(inputGain);
      stick.connect(snapFilter).connect(noiseGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: low, voice2: high, voice3: stick,
        trigger(time, velocity) {
          scheduleVelocityEnvelope(time, velocity, decay + 0.03);
          low.triggerAttackRelease(tune, decay + 0.02, time, velocity * 0.78);
          high.triggerAttackRelease(tune * 2.72, decay * 0.62, time, velocity * 0.55);
          stick.triggerAttackRelease(0.012, time, velocity * snap);
        },
      });
    }
    case 'tomLowFloor':
    case 'tomHighFloor':
    case 'tom':
    case 'tomLowMid':
    case 'tomHighMid':
    case 'tomHigh': {
      const tune = Number(parameters.tune ?? 110);
      const decay = Number(parameters.decay ?? 0.34);
      const sweep = Number(parameters.sweep ?? 1.3);
      const sweepTime = Number(parameters.sweepTime ?? 0.035);
      const body = createTriggeredVoicePool(
        () => new Tone.MembraneSynth({ octaves: sweep, pitchDecay: sweepTime, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay, sustain: 0.025, release: decay * 0.45 } }),
        (duration) => Math.max(0.001 + decay, duration + decay * 0.45),
        owned,
      );
      const shell = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: decay * 0.48, sustain: 0, release: 0.035 } }),
        (duration) => Math.max(0.001 + decay * 0.48, duration + 0.035),
        owned,
      );
      const toneGain = new Tone.Gain(0.22);
      register(owned, toneGain);
      body.connect(inputGain);
      shell.connect(toneGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: body, voice2: shell,
        trigger(time, velocity, duration) {
          const naturalDuration = decay * 1.45 + sweepTime;
          scheduleVelocityEnvelope(time, velocity, naturalDuration);
          body.triggerAttackRelease(tune, Math.max(naturalDuration, duration ?? decay), time, velocity);
          shell.triggerAttackRelease(tune * 2.08, decay * 0.58, time, velocity * 0.42);
        },
      });
    }
    case 'congaMuted':
    case 'congaOpen':
    case 'conga': {
      const tune = Number(parameters.tune ?? 196);
      const decay = Number(parameters.decay ?? 0.26);
      const snap = clamp(Number(parameters.snap ?? 0.16), 0, 1);
      const body = createTriggeredVoicePool(
        () => new Tone.MembraneSynth({ octaves: Number(parameters.sweep ?? 0.35), pitchDecay: Number(parameters.sweepTime ?? 0.018), oscillator: { type: 'sine' }, envelope: { attack: 0.0008, decay, sustain: 0, release: decay * 0.18 } }),
        (duration) => Math.max(0.0008 + decay, duration + decay * 0.18),
        owned,
      );
      const slap = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({ noise: { type: 'pink' as any }, envelope: { attack: 0.0005, decay: 0.018, sustain: 0, release: 0.006 } }),
        (duration) => Math.max(0.0005 + 0.018, duration + 0.006),
        owned,
      );
      const snapFilter = new Tone.Filter({ type: 'bandpass', frequency: Number(parameters.color ?? 3200), Q: 1.6 });
      const snapGain = new Tone.Gain(snap);
      register(owned, snapFilter, snapGain);
      body.connect(inputGain);
      slap.connect(snapFilter).connect(snapGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: body, voice2: slap,
        trigger(time, velocity, duration) {
          scheduleVelocityEnvelope(time, velocity, decay + 0.08);
          body.triggerAttackRelease(tune, Math.max(decay * 1.2, duration ?? decay), time, velocity);
          slap.triggerAttackRelease(0.025, time, velocity * snap);
        },
      });
    }
    case 'timbale':
    case 'timbaleLow': {
      const tune = Number(parameters.tune ?? 260);
      const decay = Number(parameters.decay ?? 0.22);
      const body = createTriggeredVoicePool(
        () => new Tone.MembraneSynth({ octaves: Number(parameters.sweep ?? 0.15), pitchDecay: Number(parameters.sweepTime ?? 0.01), envelope: { attack: 0.0005, decay, sustain: 0, release: decay * 0.16 } }),
        (duration) => Math.max(0.0005 + decay, duration + decay * 0.16),
        owned,
      );
      const shell = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.0004, decay: decay * 0.32, sustain: 0, release: 0.012 } }),
        (duration) => Math.max(0.0004 + decay * 0.32, duration + 0.012),
        owned,
      );
      const toneFilter = new Tone.Filter({ type: 'bandpass', frequency: Number(parameters.color ?? 4400), Q: 1.2 });
      const toneGain = new Tone.Gain(clamp(Number(parameters.snap ?? 0.3), 0, 0.55));
      register(owned, toneFilter, toneGain);
      body.connect(inputGain);
      shell.connect(toneFilter).connect(toneGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: body, voice2: shell,
        trigger(time, velocity, duration) {
          scheduleVelocityEnvelope(time, velocity, decay + 0.05);
          body.triggerAttackRelease(tune, Math.max(decay, duration ?? decay), time, velocity);
          shell.triggerAttackRelease(tune * 4.13, decay * 0.4, time, velocity * 0.46);
        },
      });
    }
    case 'cowbell': {
      const tune = Number(parameters.tune ?? 560);
      const decay = Number(parameters.decay ?? 0.22);
      const low = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.0005, decay, sustain: 0, release: decay * 0.22 } }),
        (duration) => Math.max(0.0005 + decay, duration + decay * 0.22),
        owned,
      );
      const high = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.0005, decay: decay * 0.72, sustain: 0, release: decay * 0.16 } }),
        (duration) => Math.max(0.0005 + decay * 0.72, duration + decay * 0.16),
        owned,
      );
      const toneFilter = new Tone.Filter({ type: 'bandpass', frequency: Number(parameters.brightness ?? 7000) * 0.24, Q: 0.65 });
      const toneGain = new Tone.Gain(0.48);
      register(owned, toneFilter, toneGain);
      low.connect(toneFilter);
      high.connect(toneFilter).connect(toneGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: low, voice2: high,
        trigger(time, velocity) {
          scheduleVelocityEnvelope(time, velocity, decay + 0.05);
          low.triggerAttackRelease(tune, decay * 1.2, time, velocity);
          high.triggerAttackRelease(tune * 1.481, decay, time, velocity * 0.82);
        },
      });
    }
    case 'chimes': {
      const tune = Number(parameters.tune ?? 1047);
      const decay = Number(parameters.decay ?? 2.6);
      const fundamental = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay, sustain: 0, release: decay * 0.55 } }),
        (duration) => Math.max(0.001 + decay, duration + decay * 0.55),
        owned,
      );
      const partialA = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: decay * 0.72, sustain: 0, release: decay * 0.38 } }),
        (duration) => Math.max(0.001 + decay * 0.72, duration + decay * 0.38),
        owned,
      );
      const partialB = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: decay * 0.48, sustain: 0, release: decay * 0.25 } }),
        (duration) => Math.max(0.001 + decay * 0.48, duration + decay * 0.25),
        owned,
      );
      const toneGain = new Tone.Gain(0.62);
      register(owned, toneGain);
      fundamental.connect(toneGain);
      partialA.connect(toneGain);
      partialB.connect(toneGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: fundamental, voice2: partialA, voice3: partialB,
        trigger(time, velocity, duration) {
          const safeDuration = Math.max(decay * 1.55, duration ?? decay);
          scheduleVelocityEnvelope(time, velocity, safeDuration);
          fundamental.triggerAttackRelease(tune, safeDuration, time, velocity * 0.76);
          partialA.triggerAttackRelease(tune * 2.756, decay * 1.1, time, velocity * 0.34);
          partialB.triggerAttackRelease(tune * 5.404, decay * 0.72, time, velocity * 0.18);
        },
      });
    }
    case 'triangleMuted':
    case 'triangle': {
      const tune = Number(parameters.tune ?? 880);
      const decay = Number(parameters.decay ?? 1.1);
      const ring = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.0005, decay, sustain: 0, release: decay * 0.9 } }),
        (duration) => Math.max(0.0005 + decay, duration + decay * 0.9),
        owned,
      );
      const overtone = createTriggeredVoicePool(
        () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.0003, decay: decay * 0.62, sustain: 0, release: decay * 0.42 } }),
        (duration) => Math.max(0.0003 + decay * 0.62, duration + decay * 0.42),
        owned,
      );
      const toneGain = new Tone.Gain(0.56);
      register(owned, toneGain);
      ring.connect(toneGain);
      overtone.connect(toneGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: ring, voice2: overtone,
        trigger(time, velocity, duration) {
          const safeDuration = Math.max(decay * 1.9, duration ?? decay);
          scheduleVelocityEnvelope(time, velocity, safeDuration);
          ring.triggerAttackRelease(tune, safeDuration, time, velocity * 0.78);
          overtone.triggerAttackRelease(tune * 3.92, decay * 1.05, time, velocity * 0.24);
        },
      });
    }
    case 'ride':
    case 'rideBell':
    case 'ride2': {
      const tune = Number(parameters.tune ?? 320);
      const decay = Number(parameters.decay ?? 1.8);
      const wash = clamp(Number(parameters.wash ?? 0.38), 0.12, 0.75);
      const bow = createTriggeredVoicePool(
        () => {
          const voice = new Tone.MetalSynth({ envelope: { attack: 0.0007, decay, release: decay * 0.72 }, harmonicity: Number(parameters.harmonicity ?? 2.8), modulationIndex: Number(parameters.modIndex ?? 42), resonance: Number(parameters.brightness ?? 11000), octaves: 1.35 });
          keepMetalOscillatorsRunning(voice);
          return voice;
        },
        (duration) => duration + decay * 0.72,
        owned,
        MAX_POOLED_METAL_VOICES,
      );
      const washDecay = decay * 0.95;
      const washRelease = decay * 0.5;
      const washNoise = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({ noise: { type: 'white' as any }, envelope: { attack: 0.001, decay: washDecay, sustain: 0, release: washRelease } }),
        (duration) => Math.max(0.001 + washDecay, duration + washRelease),
        owned,
      );
      const noiseFilter = new Tone.Filter({ type: 'bandpass', frequency: 7200, Q: 0.38 });
      const noiseGain = new Tone.Gain(wash);
      register(owned, noiseFilter, noiseGain);
      bow.connect(inputGain);
      washNoise.connect(noiseFilter).connect(noiseGain).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: bow, voice2: washNoise,
        trigger(time, velocity, duration) {
          const safeDuration = Math.max(decay * 1.72, duration ?? decay);
          scheduleVelocityEnvelope(time, velocity, safeDuration);
          bow.triggerAttackRelease(tune, safeDuration, time, velocity * 0.82);
          washNoise.triggerAttackRelease(decay * 1.45, time, velocity * wash);
        },
      });
    }
    case 'shaker': {
      const decay = Number(parameters.decay ?? 0.12);
      const color = Number(parameters.color ?? 7500);
      const snap = clamp(Number(parameters.snap ?? 0.85), 0, 1);
      const noiseDecay = Math.max(0.009, decay * 0.18);
      const noiseRelease = 0.006;
      const noise = createTriggeredVoicePool(
        () => new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.0003, decay: noiseDecay, sustain: 0, release: noiseRelease },
        }),
        (duration) => Math.max(0.0003 + noiseDecay, duration + noiseRelease),
        owned,
      );
      const noiseFilter = new Tone.Filter({ type: 'bandpass', frequency: color, Q: 1.25 });
      register(owned, noiseFilter);
      noise.connect(noiseFilter).connect(inputGain);
      return finish({
        node: postVca, filter, preGain: inputGain, voice: noise,
        trigger(time, velocity) {
          scheduleVelocityEnvelope(time, velocity, decay + 0.04);
          [0, 0.011, 0.026, 0.044, 0.067].forEach((offset, index) => {
            const peak = velocity * snap * (0.62 + index * 0.07);
            noise.triggerAttackRelease(
              Math.max(0.012, decay * (0.18 + index * 0.035)),
              time + offset,
              peak,
            );
          });
        },
      });
    }
  }
}
