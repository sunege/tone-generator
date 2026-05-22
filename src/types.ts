export const WAVETABLE_SIZE = 1024

export type Envelope = {
  attack: number  // seconds
  decay: number   // seconds
  sustain: number // 0..1
  release: number // seconds
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass'

export type FilterParams = {
  cutoff: number // Hz
  type: FilterType
  q: number      // BiquadFilter Q (0.0001 でほぼフラット、10 超でリング)
}

// フィルター用 ADSR。音量 ADSR と独立で、cutoff に加算モジュレーションする。
// depth が正なら立ち上がりで cutoff が上方向にスイープ、負なら下方向。
export type FilterEnvelope = {
  enabled: boolean
  attack: number   // seconds
  decay: number    // seconds
  sustain: number  // 0..1
  release: number  // seconds
  depth: number    // Hz（バイポーラ、-8000〜+8000 程度）
}

export type LfoWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square'
export type LfoTarget = 'amp' | 'filter' | 'pitch'

export type LfoParams = {
  enabled: boolean
  waveform: LfoWaveform
  rate: number    // Hz (0.1〜20)
  depth: number   // 0..1（行き先に応じて AudioEngine がスケール）
  target: LfoTarget
}

// エフェクター（FX）チェーン
export type FxId = 'delay' | 'reverb' | 'chorus' | 'phaser' | 'distortion' | 'bitcrusher'

export type FxState = {
  enabled: boolean
  params: Record<string, number>
}

export type FxChainState = {
  order: FxId[]
  fx: Record<FxId, FxState>
}

// ステップシーケンサー（Step7）
export const SEQUENCER_MAX_STEPS = 32

export type SeqStep = {
  enabled: boolean
  semitones: number  // root からの半音オフセット（±）
}

export type SequencerState = {
  bpm: number            // 60..240
  division: number       // 1=全, 2=半, 4=4分, 8=8分, 16=16分, 32=32分
  length: number         // 再生するステップ数 1..32
  gate: number           // 0..1 ステップ長に対するゲート時間比
  steps: SeqStep[]       // 長さ SEQUENCER_MAX_STEPS で固定
}

export type SynthPatch = {
  wavetable: Float32Array
  envelope: Envelope
  filter: FilterParams
  filterEnvelope: FilterEnvelope
  lfo: LfoParams
  fx: FxChainState
  sequencer: SequencerState
}

export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7
