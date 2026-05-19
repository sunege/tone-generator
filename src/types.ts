export const WAVETABLE_SIZE = 1024

export type Envelope = {
  attack: number  // seconds
  decay: number   // seconds
  sustain: number // 0..1
  release: number // seconds
}

export type FilterParams = {
  cutoff: number // Hz
}

export type SynthPatch = {
  wavetable: Float32Array
  envelope: Envelope
  filter: FilterParams
}

export type StepId = 1 | 2 | 3 | 4
