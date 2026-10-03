/** Shift onsets by a fraction of one step, wrapping inside the sequence's fixed duration. */
export function applyTrackPhase(localTime: number, phase: number, quant: number, patternDuration: number): number {
  if (phase === 0) return localTime;
  const shifted = localTime + phase * quant;
  const wrapped = shifted % patternDuration;
  // A full-step shift can land a rounding error away from the loop boundary.
  const tolerance = Number.EPSILON * Math.max(patternDuration, shifted) * 4;
  return wrapped < tolerance || patternDuration - wrapped < tolerance ? 0 : wrapped;
}
