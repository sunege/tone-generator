import type {
  Envelope,
  FilterEnvelope,
  FilterParams,
  FxChainState,
  FxId,
  LfoParams,
  SequencerState,
  SeqStep,
  SynthPatch,
} from '../types'
import { SEQUENCER_MAX_STEPS } from '../types'
import { getPreset } from './wavetablePresets'
import { ENV_PRESETS } from './envelopePresets'

// ──────────────────────────────────────────────── 型

export const BANK_COUNT = 5

export type WaveEditorMode = 'draw' | 'formula'

/** UI 側の付随状態。プリセットマーカーや数式テキストを復元するために含める。 */
export type ToneBankUiState = {
  activePresetKey?: string
  activeEnvelopePresetKey?: string
  waveEditorMode?: WaveEditorMode
  waveEditorFormula?: string
}

/**
 * 音色バンク（Step1〜6 由来のパッチを保持。sequencer は別バンクなので含めない）。
 * wavetable は実行時 Float32Array、保存時は number[] に変換する。
 */
export type ToneBank = {
  label: string
  patch: {
    wavetable: Float32Array
    envelope: Envelope
    filter: FilterParams
    filterEnvelope: FilterEnvelope
    lfo: LfoParams
    lfo2: LfoParams
    fx: FxChainState
  }
  ui: ToneBankUiState
}

/** シーケンサーバンク（Step7 で編集するパターン）。 */
export type SeqBank = {
  label: string
  sequencer: SequencerState
}

export type BanksState = {
  tone: (ToneBank | null)[]   // length BANK_COUNT
  seq: (SeqBank | null)[]     // length BANK_COUNT
}

// ──────────────────────────────────────────────── デフォルト FX

export function defaultFx(): FxChainState {
  return {
    order: ['distortion', 'bitcrusher', 'chorus', 'phaser', 'delay', 'reverb'],
    fx: {
      distortion: { enabled: false, params: { drive: 20, tone: 3000, wet: 0.5 } },
      bitcrusher: { enabled: false, params: { bits: 6, downsample: 4, wet: 0.5 } },
      chorus:     { enabled: false, params: { rate: 1.2, depth: 0.5, wet: 0.5 } },
      phaser:     { enabled: false, params: { rate: 0.4, depth: 0.7, feedback: 0.5, wet: 0.5 } },
      delay:      { enabled: false, params: { time: 0.35, feedback: 0.4, wet: 0.35 } },
      reverb:     { enabled: false, params: { decay: 2.5, wet: 0.3 } },
    },
  }
}

const envOf = (key: 'piano' | 'organ' | 'strings' | 'percussion'): Envelope => {
  const p = ENV_PRESETS.find((e) => e.key === key)
  if (!p) throw new Error(`envelope preset not found: ${key}`)
  return { ...p.envelope }
}

// ──────────────────────────────────────────────── デモ音色バンク

function makeDemoToneBanks(): (ToneBank | null)[] {
  // bank 1: ピアノ風（三角波 + 速い立ち上がり + 緩やかな減衰）
  const fx1 = defaultFx()
  const bank1: ToneBank = {
    label: 'ピアノ',
    patch: {
      wavetable: getPreset('triangle').generate(),
      envelope: envOf('piano'),
      filter: { cutoff: 4000, type: 'lowpass', q: 0.5 },
      filterEnvelope: { enabled: false, attack: 0.01, decay: 0.4, sustain: 0, release: 0.3, depth: 3000 },
      lfo:  { enabled: false, waveform: 'sine', rate: 5, depth: 0.3, target: 'amp' },
      lfo2: { enabled: false, waveform: 'triangle', rate: 3, depth: 0.3, target: 'filter' },
      fx: fx1,
    },
    ui: {
      activePresetKey: 'triangle',
      activeEnvelopePresetKey: 'piano',
      waveEditorMode: 'draw',
      waveEditorFormula: 'sin(x)',
    },
  }

  // bank 2: クラリネット風オルガン（持続音、明るめのフィルタ）
  const fx2 = defaultFx()
  const bank2: ToneBank = {
    label: 'クラリネット',
    patch: {
      wavetable: getPreset('clarinet').generate(),
      envelope: envOf('organ'),
      filter: { cutoff: 5000, type: 'lowpass', q: 1 },
      filterEnvelope: { enabled: false, attack: 0.01, decay: 0.4, sustain: 0, release: 0.3, depth: 3000 },
      lfo:  { enabled: false, waveform: 'sine', rate: 5, depth: 0.3, target: 'amp' },
      lfo2: { enabled: false, waveform: 'triangle', rate: 3, depth: 0.3, target: 'filter' },
      fx: fx2,
    },
    ui: {
      activePresetKey: 'clarinet',
      activeEnvelopePresetKey: 'organ',
      waveEditorMode: 'draw',
      waveEditorFormula: 'sin(x)',
    },
  }

  // bank 3: ベル風（金属波 + 打楽器エンベロープ + ディレイで余韻）
  const fx3 = defaultFx()
  fx3.fx.delay = { enabled: true, params: { time: 0.28, feedback: 0.45, wet: 0.45 } }
  fx3.fx.reverb = { enabled: true, params: { decay: 2.5, wet: 0.25 } }
  const bank3: ToneBank = {
    label: 'ベル',
    patch: {
      wavetable: getPreset('metallic').generate(),
      envelope: { attack: 0.001, decay: 0.6, sustain: 0.0, release: 0.4 },
      filter: { cutoff: 9000, type: 'lowpass', q: 0.5 },
      filterEnvelope: { enabled: false, attack: 0.01, decay: 0.4, sustain: 0, release: 0.3, depth: 3000 },
      lfo:  { enabled: false, waveform: 'sine', rate: 5, depth: 0.3, target: 'amp' },
      lfo2: { enabled: false, waveform: 'triangle', rate: 3, depth: 0.3, target: 'filter' },
      fx: fx3,
    },
    ui: {
      activePresetKey: 'metallic',
      activeEnvelopePresetKey: undefined,  // カスタムエンベロープ
      waveEditorMode: 'draw',
      waveEditorFormula: 'sin(x)',
    },
  }

  // bank 4: シンセリード（ノコギリ + フィルター ADSR スイープ + ビブラート）
  const fx4 = defaultFx()
  fx4.fx.reverb = { enabled: true, params: { decay: 1.8, wet: 0.2 } }
  const bank4: ToneBank = {
    label: 'シンセリード',
    patch: {
      wavetable: getPreset('sawtooth').generate(),
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.25 },
      filter: { cutoff: 1500, type: 'lowpass', q: 6 },
      filterEnvelope: { enabled: true, attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.3, depth: 6000 },
      lfo:  { enabled: true, waveform: 'sine', rate: 5.5, depth: 0.05, target: 'pitch' },
      lfo2: { enabled: false, waveform: 'triangle', rate: 3, depth: 0.3, target: 'filter' },
      fx: fx4,
    },
    ui: {
      activePresetKey: 'sawtooth',
      activeEnvelopePresetKey: undefined,
      waveEditorMode: 'draw',
      waveEditorFormula: 'sin(x)',
    },
  }

  // bank 5: 8ビット風（矩形波 + ビットクラッシャー）
  const fx5 = defaultFx()
  fx5.fx.bitcrusher = { enabled: true, params: { bits: 4, downsample: 4, wet: 1 } }
  const bank5: ToneBank = {
    label: '8ビット',
    patch: {
      wavetable: getPreset('square').generate(),
      envelope: { attack: 0.001, decay: 0.05, sustain: 0.85, release: 0.05 },
      filter: { cutoff: 8000, type: 'lowpass', q: 0.5 },
      filterEnvelope: { enabled: false, attack: 0.01, decay: 0.4, sustain: 0, release: 0.3, depth: 3000 },
      lfo:  { enabled: false, waveform: 'sine', rate: 5, depth: 0.3, target: 'amp' },
      lfo2: { enabled: false, waveform: 'triangle', rate: 3, depth: 0.3, target: 'filter' },
      fx: fx5,
    },
    ui: {
      activePresetKey: 'square',
      activeEnvelopePresetKey: undefined,
      waveEditorMode: 'draw',
      waveEditorFormula: 'sin(x)',
    },
  }

  return [bank1, bank2, bank3, bank4, bank5]
}

// ──────────────────────────────────────────────── デモシーケンサーバンク

function makeSteps(pattern: number[], length: number): SeqStep[] {
  return Array.from({ length: SEQUENCER_MAX_STEPS }, (_, i) => ({
    enabled: i < length,
    semitones: pattern[i % pattern.length] ?? 0,
  }))
}

function makeDemoSeqBanks(): (SeqBank | null)[] {
  // bank 1: メジャースケール上昇（C D E F G A B C）
  const bank1: SeqBank = {
    label: 'メジャーS',
    sequencer: { bpm: 110, division: 8, length: 8, gate: 0.5, steps: makeSteps([0, 2, 4, 5, 7, 9, 11, 12], 8) },
  }

  // bank 2: メジャー上昇アルペジオ
  const bank2: SeqBank = {
    label: 'メジャー',
    sequencer: { bpm: 120, division: 16, length: 16, gate: 0.5, steps: makeSteps([0, 4, 7, 12], 16) },
  }
  // bank 3: マイナー上昇アルペジオ
  const bank3: SeqBank = {
    label: 'マイナー',
    sequencer: { bpm: 120, division: 16, length: 16, gate: 0.5, steps: makeSteps([0, 3, 7, 10], 16) },
  }
  // bank 4: ベースライン（オクターブ上下）
  const bank4: SeqBank = {
    label: 'ベース',
    sequencer: { bpm: 110, division: 8, length: 8, gate: 0.45, steps: makeSteps([0, 0, 12, 0, 7, 0, 12, 0], 8) },
  }
  // bank 5: ペンタトニックフレーズ
  const bank5: SeqBank = {
    label: 'ペンタ',
    sequencer: { bpm: 130, division: 16, length: 16, gate: 0.35, steps: makeSteps([0, 3, 5, 7, 10, 7, 5, 3], 16) },
  }

  return [bank1, bank2, bank3, bank4, bank5]
}

export function makeInitialBanks(): BanksState {
  return { tone: makeDemoToneBanks(), seq: makeDemoSeqBanks() }
}

// ──────────────────────────────────────────────── 現在の patch ⇄ ToneBank の橋渡し

/** 現在の patch + UI 状態から ToneBank を生成（保存用）。 */
export function toneBankFromPatch(
  patch: SynthPatch,
  ui: ToneBankUiState,
  label: string,
): ToneBank {
  return {
    label,
    patch: {
      wavetable: new Float32Array(patch.wavetable),
      envelope: { ...patch.envelope },
      filter: { ...patch.filter },
      filterEnvelope: { ...patch.filterEnvelope },
      lfo: { ...patch.lfo },
      lfo2: { ...patch.lfo2 },
      fx: cloneFx(patch.fx),
    },
    ui: { ...ui },
  }
}

/** ToneBank から SynthPatch を構築。sequencer は呼び出し側が現在の値を渡す。 */
export function patchFromToneBank(bank: ToneBank, currentSequencer: SequencerState): SynthPatch {
  return {
    wavetable: new Float32Array(bank.patch.wavetable),
    envelope: { ...bank.patch.envelope },
    filter: { ...bank.patch.filter },
    filterEnvelope: { ...bank.patch.filterEnvelope },
    lfo: { ...bank.patch.lfo },
    lfo2: { ...bank.patch.lfo2 },
    fx: cloneFx(bank.patch.fx),
    sequencer: currentSequencer,
  }
}

function cloneFx(fx: FxChainState): FxChainState {
  const cloned: FxChainState = { order: [...fx.order], fx: {} as FxChainState['fx'] }
  for (const id of Object.keys(fx.fx) as FxId[]) {
    cloned.fx[id] = { enabled: fx.fx[id].enabled, params: { ...fx.fx[id].params } }
  }
  return cloned
}

// ──────────────────────────────────────────────── 永続化（localStorage + JSON）

const STORAGE_KEY = 'tone-generator:banks:v2'
const SCHEMA_VERSION = 2

type SerializedToneBank = Omit<ToneBank, 'patch'> & {
  patch: Omit<ToneBank['patch'], 'wavetable'> & { wavetable: number[] }
}

type SerializedBanks = {
  version: number
  tone: (SerializedToneBank | null)[]
  seq: (SeqBank | null)[]
}

function serializeToneBank(b: ToneBank): SerializedToneBank {
  return {
    label: b.label,
    ui: { ...b.ui },
    patch: {
      ...b.patch,
      wavetable: Array.from(b.patch.wavetable),
    },
  }
}

function deserializeToneBank(s: SerializedToneBank): ToneBank {
  return {
    label: s.label,
    ui: { ...s.ui },
    patch: {
      ...s.patch,
      wavetable: new Float32Array(s.patch.wavetable),
    },
  }
}

export function serializeBanks(banks: BanksState): string {
  const data: SerializedBanks = {
    version: SCHEMA_VERSION,
    tone: banks.tone.map((b) => (b ? serializeToneBank(b) : null)),
    seq: banks.seq.map((b) => (b ? { ...b, sequencer: { ...b.sequencer, steps: b.sequencer.steps.map((s) => ({ ...s })) } } : null)),
  }
  return JSON.stringify(data, null, 2)
}

export function deserializeBanks(json: string): BanksState {
  const parsed = JSON.parse(json) as Partial<SerializedBanks>
  if (parsed.version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported bank file version: ${parsed.version}`)
  }
  const fillTone = (arr: (SerializedToneBank | null)[] | undefined): (ToneBank | null)[] => {
    const out: (ToneBank | null)[] = []
    for (let i = 0; i < BANK_COUNT; i++) {
      const s = arr?.[i]
      out.push(s ? deserializeToneBank(s) : null)
    }
    return out
  }
  const fillSeq = (arr: (SeqBank | null)[] | undefined): (SeqBank | null)[] => {
    const out: (SeqBank | null)[] = []
    for (let i = 0; i < BANK_COUNT; i++) {
      const s = arr?.[i]
      out.push(s ? { label: s.label, sequencer: { ...s.sequencer, steps: s.sequencer.steps.map((x) => ({ ...x })) } } : null)
    }
    return out
  }
  return { tone: fillTone(parsed.tone), seq: fillSeq(parsed.seq) }
}

export function loadBanksFromStorage(): BanksState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return makeInitialBanks()
    return deserializeBanks(raw)
  } catch (e) {
    console.warn('[banks] localStorage の読み込みに失敗。デモバンクで初期化します。', e)
    return makeInitialBanks()
  }
}

export function persistBanksToStorage(banks: BanksState) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeBanks(banks))
  } catch (e) {
    console.warn('[banks] localStorage への書き込みに失敗', e)
  }
}
