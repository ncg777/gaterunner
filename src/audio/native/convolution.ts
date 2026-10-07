/** In-place radix-two complex FFT. Work buffers use doubles to keep long tails accurate. */
function fft(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index++) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / width;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      for (let offset = 0; offset < width / 2; offset++) {
        const even = start + offset;
        const odd = even + width / 2;
        const oddReal = real[odd] * rotationReal - imaginary[odd] * rotationImaginary;
        const oddImaginary = real[odd] * rotationImaginary + imaginary[odd] * rotationReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary;
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
        rotationReal = nextReal;
      }
    }
  }
  if (inverse) for (let index = 0; index < size; index++) {
    real[index] /= size;
    imaginary[index] /= size;
  }
}

/** Overlap-add convolution, bounded by impulse length rather than song duration. */
export function convolveInto(input: Float32Array, impulse: Float32Array, output: Float32Array, gain = 1): void {
  if (!input.length || !impulse.length || gain === 0) return;
  let inputLength = input.length;
  while (inputLength > 0 && input[inputLength - 1] === 0) inputLength--;
  if (inputLength === 0) return;
  let size = 2;
  while (size < impulse.length * 2) size *= 2;
  const blockSize = size - impulse.length + 1;
  const impulseReal = new Float64Array(size);
  const impulseImaginary = new Float64Array(size);
  impulseReal.set(impulse);
  fft(impulseReal, impulseImaginary);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let start = 0; start < inputLength && start < output.length; start += blockSize) {
    const end = Math.min(inputLength, start + blockSize);
    real.fill(0);
    imaginary.fill(0);
    real.set(input.subarray(start, end));
    fft(real, imaginary);
    for (let bin = 0; bin < size; bin++) {
      const product = real[bin] * impulseReal[bin] - imaginary[bin] * impulseImaginary[bin];
      imaginary[bin] = real[bin] * impulseImaginary[bin] + imaginary[bin] * impulseReal[bin];
      real[bin] = product;
    }
    fft(real, imaginary, true);
    const frames = Math.min(output.length - start, end - start + impulse.length - 1);
    for (let frame = 0; frame < frames; frame++) output[start + frame] += real[frame] * gain;
  }
}
