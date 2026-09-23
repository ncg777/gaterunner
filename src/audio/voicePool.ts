import type * as Tone from 'tone';

/** Absolute ceiling used by offline rendering, matching Tone's own default. */
export const MAX_POOLED_VOICES = 32;

/**
 * Realtime headroom target for retained PitchEnvelopeSynth graphs. Each voice owns
 * considerably more native nodes than the Tone.Synth voices used by older releases.
 * Keeping all 32 graphs alive per track overloaded mobile audio render threads even
 * when the preset requested only eight musical voices. This is a headroom target,
 * never a limit below the track's requested polyphony. Offline exports use the full
 * ceiling because they are not constrained by a realtime deadline.
 */
export const MAX_REALTIME_POOLED_VOICES = 12;

/**
 * Tone voices to allocate for a track that should sound `polyphony` notes at once.
 * Voices are reserved when a note is scheduled, before it actually sounds, and
 * remain allocated through the amp-envelope tail and Tone's deferred stop callback.
 * Reserve a scheduling window on either side of that tail. Extra voices follow the
 * pattern's chord size so single-note tracks do not allocate full chords of headroom.
 */
export function getSynthVoiceCount(
  polyphony: number,
  releaseSeconds = 0,
  eventIntervalSeconds = Number.POSITIVE_INFINITY,
  lookAheadSeconds = 0,
  notesPerEvent = polyphony,
  maximumVoices = MAX_POOLED_VOICES,
): number {
  const musicalVoices = Math.max(1, Math.min(MAX_POOLED_VOICES, Math.round(polyphony)));
  const ceiling = Math.max(musicalVoices, Math.min(MAX_POOLED_VOICES, Math.round(maximumVoices)));
  const eventVoices = Math.max(1, Math.min(musicalVoices, Math.round(notesPerEvent)));
  const reservationSeconds = Math.max(0, Number.isFinite(releaseSeconds) ? releaseSeconds : 0)
    + 2 * Math.max(0, Number.isFinite(lookAheadSeconds) ? lookAheadSeconds : 0);
  const reservationIntervals = Number.isFinite(reservationSeconds)
    && Number.isFinite(eventIntervalSeconds)
    && reservationSeconds > 0
    && eventIntervalSeconds > 0
    ? Math.ceil(reservationSeconds / eventIntervalSeconds)
    : 0;
  return Math.min(ceiling, musicalVoices + eventVoices * reservationIntervals);
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
    isOffline: boolean;
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
 * oscillators stopped (so they cost no audio CPU) and are simply re-triggered. Realtime
 * voices above `poolSize` are collected. Offline voices stay allocated until rendering
 * completes because their earlier scheduled notes have not been rendered yet.
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
    // Tone schedules the entire offline timeline before native rendering begins.
    // An available voice may still own notes scheduled earlier in that timeline.
    if (this.context.isOffline || this._voices.length <= retention.size || this._availableVoices.length === 0) {
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
