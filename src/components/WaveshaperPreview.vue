<script lang="ts">
import { defineComponent, type PropType } from 'vue';

export default defineComponent({
  name: 'WaveshaperPreview',
  props: {
    curve: { type: Object as PropType<Float32Array | null>, default: null },
    error: { type: String as PropType<string | null>, default: null },
    label: { type: String, default: 'Waveshaper transfer curve' },
  },
  computed: {
    validCurve(): boolean {
      return !this.error && this.curve !== null && this.curve.length >= 2 && this.curve.every(Number.isFinite);
    },
    curvePath(): string {
      if (!this.validCurve || !this.curve) return 'M -1 1 L 1 -1';
      return Array.from(this.curve, (value, index) => {
        const input = -1 + (2 * index) / (this.curve!.length - 1);
        return `${index === 0 ? 'M' : 'L'} ${input} ${-value}`;
      }).join(' ');
    },
    accessibleLabel(): string {
      return `${this.label}. Input and output from -1 to +1.${this.validCurve ? '' : ' Bypass (identity).'}`;
    },
  },
});
</script>

<template>
  <div class="waveshaper-preview">
    <svg viewBox="0 0 280 180" class="waveshaper-preview__svg" role="img" :aria-label="accessibleLabel">
      <title>{{ accessibleLabel }}</title>
      <rect x="32" y="12" width="216" height="128" class="waveshaper-preview__background" />
      <path d="M 32 76 H 248 M 140 12 V 140" class="waveshaper-preview__axis" />
      <svg x="32" y="12" width="216" height="128" viewBox="-1 -1 2 2" preserveAspectRatio="none" overflow="hidden" aria-hidden="true">
        <path d="M -1 1 L 1 -1" class="waveshaper-preview__identity" vector-effect="non-scaling-stroke" />
        <path :d="curvePath" class="waveshaper-preview__curve" :class="{ 'waveshaper-preview__curve--bypass': !validCurve }"
          vector-effect="non-scaling-stroke" />
      </svg>
      <g class="waveshaper-preview__labels" aria-hidden="true">
        <text x="32" y="154" text-anchor="middle">-1</text>
        <text x="140" y="154" text-anchor="middle">0</text>
        <text x="248" y="154" text-anchor="middle">+1</text>
        <text x="26" y="16" text-anchor="end">+1</text>
        <text x="26" y="80" text-anchor="end">0</text>
        <text x="26" y="140" text-anchor="end">-1</text>
        <text x="140" y="173" text-anchor="middle">Input</text>
        <text transform="translate(10 76) rotate(-90)" text-anchor="middle">Output</text>
      </g>
    </svg>
    <p v-if="!validCurve" class="waveshaper-preview__status" :class="{ 'waveshaper-preview__status--error': error }" role="status">
      {{ error ? `${error} Bypass (identity).` : 'Bypass (identity).' }}
    </p>
  </div>
</template>

<style scoped>
.waveshaper-preview {
  min-width: 0;
  width: 100%;
  max-width: 420px;
}
.waveshaper-preview__svg {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 14 / 9;
}
.waveshaper-preview__background {
  fill: var(--panel-inset, #10120f);
  stroke: var(--panel-border-soft, #5a594e);
}
.waveshaper-preview__axis {
  fill: none;
  stroke: rgba(170, 167, 141, 0.3);
}
.waveshaper-preview__identity {
  fill: none;
  stroke: rgba(170, 167, 141, 0.65);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.waveshaper-preview__curve {
  fill: none;
  stroke: #f2b84b;
  stroke-width: 2;
}
.waveshaper-preview__curve--bypass {
  stroke: #aaa78d;
  stroke-dasharray: 4 4;
}
.waveshaper-preview__labels {
  fill: var(--instrument-text, #e8dfc8);
  font-size: 10px;
}
.waveshaper-preview__status {
  margin: 4px 0 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.waveshaper-preview__status--error {
  color: #e9836f;
}
</style>