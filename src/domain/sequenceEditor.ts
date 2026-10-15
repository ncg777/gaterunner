/** Visual editing is conservative: unsupported text stays editable in the source field. */
export function editableSequence(input: string, rhythmic: boolean): bigint[] | null {
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];
  const validToken = rhythmic ? /^(?:0|[1-9]\d*)$/ : /^\d+$/;
  if (tokens.some(token => !validToken.test(token))) return null;
  const values = tokens.map(token => BigInt(token));
  if (!rhythmic && values.some(value => value > BigInt(Number.MAX_SAFE_INTEGER))) return null;
  return values;
}

export function toggleSequenceCell(values: readonly bigint[], step: number, lane: number, bits = 1): string {
  const next = [...values];
  const width = BigInt(bits);
  const shift = BigInt(lane) * width;
  const mask = ((1n << width) - 1n) << shift;
  const current = next[step] ?? 0n;
  // A new drum hit uses full velocity; clearing it leaves other lanes untouched.
  next[step] = (current & mask) !== 0n ? current & ~mask : current | mask;
  return next.join(' ');
}
