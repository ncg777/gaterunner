import type * as Tone from 'tone';

/** Tone rebuilds its biquad bank even when the supplied rolloff is unchanged. */
export function setFilterSettings(filter: Tone.Filter, settings: Parameters<Tone.Filter['set']>[0]): void {
  if (settings.rolloff === filter.rolloff) {
    const { rolloff: _rolloff, ...controls } = settings;
    filter.set(controls);
  } else {
    filter.set(settings);
  }
}
