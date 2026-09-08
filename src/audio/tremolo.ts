import type * as Tone from 'tone';

type TremoloLfo = Pick<Tone.LFO, 'state'> & { _stoppedSignal: Tone.Signal<'audioRange'> };

/** Change stereo phase without restarting the running oscillators. */
export function setTremoloSpread(tremolo: Tone.Tremolo, spread: number): void {
  if (tremolo.spread === spread) {
    return;
  }

  const time = tremolo.context.now();
  tremolo.spread = spread;
  // Tone's LFO phase setter also writes its resting DC signal, even while running.
  // Clear that offset at the same time without resetting the oscillator phase.
  const { _lfoL, _lfoR } = tremolo as unknown as {
    _lfoL: TremoloLfo;
    _lfoR: TremoloLfo;
  };
  for (const lfo of [_lfoL, _lfoR]) {
    if (lfo.state === 'started') {
      lfo._stoppedSignal.cancelScheduledValues(time);
      lfo._stoppedSignal.setValueAtTime(0, time);
    }
  }
}
