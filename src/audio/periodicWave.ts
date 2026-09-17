interface PeriodicWaveContext {
  createPeriodicWave(real: number[] | Float32Array, imag: number[] | Float32Array,
    constraints?: PeriodicWaveConstraints): PeriodicWave;
}

const preparedContexts = new WeakSet<PeriodicWaveContext>();

/** Tone pads even short custom spectra to 2048 bins. Omit only silent tail bins. */
export function preparePeriodicWaveContext(context: PeriodicWaveContext): void {
  if (preparedContexts.has(context)) return;
  const create = context.createPeriodicWave;
  context.createPeriodicWave = function (real, imag, constraints) {
    // Preserve native validation for malformed inputs, including unequal lengths.
    if (real.length === imag.length && real.length > 2 && real.length <= 2048) {
      let length = real.length;
      while (length > 2 && real[length - 1] === 0 && imag[length - 1] === 0) length--;
      if (length < real.length) {
        real = real instanceof Float32Array ? real.subarray(0, length) : real.slice(0, length);
        imag = imag instanceof Float32Array ? imag.subarray(0, length) : imag.slice(0, length);
      }
    }
    return create.call(this, real, imag, constraints);
  };
  preparedContexts.add(context);
}
