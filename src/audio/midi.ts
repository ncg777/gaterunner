import * as ToneMidi from '@tonejs/midi';

// The package exposes named ESM exports in browsers and a CommonJS default in Node.
const commonJs = (ToneMidi as unknown as { default?: { Midi: typeof ToneMidi.Midi } }).default;
export const Midi = commonJs?.Midi ?? ToneMidi.Midi;
