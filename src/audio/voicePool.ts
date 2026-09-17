import type * as Tone from 'tone';

/**
 * Hard ceiling for allocated Tone voices per track, matching Tone's own default so a
 * dense track never runs out of voices mid-pattern.
 */
export const MAX_POOLED_VOICES = 32;

/**
 * Tone voices to allocate for a track that should sound `polyphony` notes at once.
 * Released voices remain allocated for the whole amp-envelope tail, so dense tracks
 * need enough additional voices to cover every note interval crossed by that tail.
 */
export function getSynthVoiceCount(
  polyphony: number,
  releaseSeconds = 0,
  eventIntervalSeconds = Number.POSITIVE_INFINITY,
): number {
  const musicalVoices = Math.max(1, Math.round(polyphony));
  const releaseIntervals = Number.isFinite(releaseSeconds)
    && Number.isFinite(eventIntervalSeconds)
    && releaseSeconds > 0
    && eventIntervalSeconds > 0
    ? Math.ceil(releaseSeconds / eventIntervalSeconds)
    : 0;
  return Math.min(MAX_POOLED_VOICES, musicalVoices * (releaseIntervals + 1));
}

export interface SoundingNote {
  frequency: number;
  endTime: number;
}

/** Overlap shorter than this is scheduling jitter rather than a held note. */
const NOTE_END_TOLERANCE_SECONDS = 1e-4;

/**
 * Reserve voices for `incoming` and return the frequencies that have to be released at
 * `startTime` to stay within `polyphony`. Tone's PolySynth silently drops a note once
 * every voice is busy, so the pattern only plays back faithfully if the oldest sounding
 * note is stolen instead.
 */
export function claimVoices(
  sounding: SoundingNote[],
  incoming: readonly number[],
  startTime: number,
  endTime: number,
  polyphony: number,
): number[] {
  for (let index = sounding.length - 1; index >= 0; index -= 1) {
    if (sounding[index].endTime <= startTime + NOTE_END_TOLERANCE_SECONDS) {
      sounding.splice(index, 1);
    }
  }

  const limit = Math.max(1, Math.floor(polyphony));
  const stolen: number[] = [];
  while (sounding.length > 0 && sounding.length + incoming.length > limit) {
    // Releasing a pitch that is being restruck would let its own queued release cut the
    // new voice short, so those are only stolen once nothing else is left.
    const index = Math.max(0, sounding.findIndex((note) => !incoming.includes(note.frequency)));
    stolen.push(sounding[index].frequency);
    sounding.splice(index, 1);
  }

  for (const frequency of incoming) {
    sounding.push({ frequency, endTime });
  }
  return stolen;
}

interface PolySynthInternals {
  context: {
    clearInterval(id: number): void;
    setInterval(callback: () => void, interval: number): number;
  };
  _voices: Array<{ dispose(): void }>;
  _availableVoices: Array<{ dispose(): void }>;
  _activeVoices: Array<{ voice: { dispose(): void }; released: boolean }>;
  _averageActiveVoices: number;
  activeVoices: number;
  _gcTimeout: number;
  _collectGarbage(): void;
  _getNextAvailableVoice(): { dispose(): void } | undefined;
}

const retainedPools = new WeakMap<PolySynthInternals, { size: number }>();

/** Allocate the requested voices before playback so offline renders capture every native voice graph. */
export function prewarmVoicePool(synth: Tone.PolySynth, voiceCount: number): void {
  const internals = synth as unknown as PolySynthInternals;
  const target = Math.max(1, Math.min(MAX_POOLED_VOICES, Math.round(voiceCount)));
  if (internals._voices.length >= target) {
    return;
  }

  const available = internals._availableVoices.splice(0);
  while (internals._voices.length < target) {
    const voice = internals._getNextAvailableVoice();
    if (!voice) {
      break;
    }
    available.push(voice);
  }
  internals._availableVoices.push(...available);
}

/**
 * Tone's PolySynth garbage collector disposes idle voices roughly once a second, so a
 * looping pattern keeps destroying and re-allocating voices. Rebuilding a voice is
 * expensive (a fresh oscillator plus a periodic-wave lookup over the custom tonewheel
 * partials for every unison oscillator), and that allocation happens on the main thread
 * right when notes are being scheduled, which is what makes several tracks stutter.
 *
 * Retaining the voices turns the synth into a true voice pool: idle voices keep their
 * oscillators stopped (so they cost no audio CPU) and are simply re-triggered. The pool
 * is still bounded by `poolSize`, so voices above that watermark are collected as before.
 */
export function retainVoicePool(synth: Tone.PolySynth, poolSize = MAX_POOLED_VOICES): void {
  const internals = synth as unknown as PolySynthInternals;
  const boundedPoolSize = Math.max(1, Math.min(MAX_POOLED_VOICES, Math.round(poolSize)));
  const previous = retainedPools.get(internals);
  if (previous) {
    previous.size = boundedPoolSize;
    return;
  }
  const retention = { size: boundedPoolSize };
  retainedPools.set(internals, retention);

  internals._collectGarbage = function collectPooledGarbage(this: PolySynthInternals) {
    this._averageActiveVoices = Math.max(this._averageActiveVoices * 0.95, this.activeVoices);
    if (this._voices.length <= retention.size || this._availableVoices.length === 0) {
      return;
    }

    const firstAvailable = this._availableVoices.shift();
    if (!firstAvailable) {
      return;
    }
    const index = this._voices.indexOf(firstAvailable);
    if (index >= 0) {
      this._voices.splice(index, 1);
    }
    firstAvailable.dispose();
  };

  if (internals._gcTimeout !== -1) {
    internals.context.clearInterval(internals._gcTimeout);
  }
  internals._gcTimeout = internals.context.setInterval(internals._collectGarbage.bind(internals), 1);
}
