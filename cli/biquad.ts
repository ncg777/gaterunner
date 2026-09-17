export interface NativeFilterSettings {
  filterEnabled: boolean;
  filterType: string;
  filterQ: number;
  filterGain: number;
  filterRolloff: number;
}
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function createStereoFilter(track: NativeFilterSettings, sampleRate: number): [
  (sample: number, cutoff: number) => number,
  (sample: number, cutoff: number) => number,
] {
  if (!track.filterEnabled) {
    return [(sample) => sample, (sample) => sample];
  }

  const quality = clamp(Number.isFinite(track.filterQ) ? track.filterQ : 1, 0.0001, 30);
  const amplitude = Math.pow(10, clamp(Number.isFinite(track.filterGain) ? track.filterGain : 0, -48, 48) / 40);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let previousCutoff = Number.NaN;
  const createChannel = () => {
    let input1 = 0;
    let input2 = 0;
    let output1 = 0;
    let output2 = 0;
    return (sample: number, cutoff: number) => {
      const frequency = clamp(Number.isFinite(cutoff) ? cutoff : 20, 0, sampleRate / 2);
      if (frequency !== previousCutoff) {
        const omega = 2 * Math.PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const resonance = track.filterType === 'lowpass' || track.filterType === 'highpass' ? 10 ** (quality / 20) : quality;
        const alpha = sine / (2 * resonance);
        const shelfTerm = Math.sqrt(2 * amplitude) * sine;
        let a0 = 1 + alpha;
        a1 = -2 * cosine;
        a2 = 1 - alpha;
        switch (track.filterType) {
          case 'highpass':
            b0 = (1 + cosine) / 2;
            b1 = -(1 + cosine);
            b2 = b0;
            break;
          case 'bandpass':
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
            break;
          case 'notch':
            b0 = 1;
            b1 = -2 * cosine;
            b2 = 1;
            break;
          case 'peaking':
            b0 = 1 + alpha * amplitude;
            b1 = -2 * cosine;
            b2 = 1 - alpha * amplitude;
            a0 = 1 + alpha / amplitude;
            a2 = 1 - alpha / amplitude;
            break;
          case 'lowshelf':
            b0 = amplitude * (amplitude + 1 - (amplitude - 1) * cosine + shelfTerm);
            b1 = 2 * amplitude * (amplitude - 1 - (amplitude + 1) * cosine);
            b2 = amplitude * (amplitude + 1 - (amplitude - 1) * cosine - shelfTerm);
            a0 = amplitude + 1 + (amplitude - 1) * cosine + shelfTerm;
            a1 = -2 * (amplitude - 1 + (amplitude + 1) * cosine);
            a2 = amplitude + 1 + (amplitude - 1) * cosine - shelfTerm;
            break;
          case 'highshelf':
            b0 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine + shelfTerm);
            b1 = -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine);
            b2 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine - shelfTerm);
            a0 = amplitude + 1 - (amplitude - 1) * cosine + shelfTerm;
            a1 = 2 * (amplitude - 1 - (amplitude + 1) * cosine);
            a2 = amplitude + 1 - (amplitude - 1) * cosine - shelfTerm;
            break;
          case 'allpass':
            b0 = 1 - alpha;
            b1 = -2 * cosine;
            b2 = 1 + alpha;
            break;
          case 'lowpass':
          default:
            b0 = (1 - cosine) / 2;
            b1 = 1 - cosine;
            b2 = b0;
            break;
        }
        b0 /= a0;
        b1 /= a0;
        b2 /= a0;
        a1 /= a0;
        a2 /= a0;
        previousCutoff = frequency;
      }
      const output = b0 * sample + b1 * input1 + b2 * input2 - a1 * output1 - a2 * output2;
      input2 = input1;
      input1 = sample;
      output2 = output1;
      output1 = output;
      return output;
    };
  };
  const createCascade = () => {
    const stages = Array.from({ length: [-12, -24, -48, -96].indexOf(track.filterRolloff) + 1 }, createChannel);
    return (sample: number, cutoff: number) => stages.reduce((value, process) => process(value, cutoff), sample);
  };
  return [createCascade(), createCascade()];
}
