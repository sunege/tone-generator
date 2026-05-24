import { create } from 'zustand'
import type { Envelope, FilterEnvelope, FilterType, FxChainState, FxId, LfoParams, SeqStep, SequencerState, SynthPatch, StepId } from '../types'
import { getPreset } from '../lib/wavetablePresets'
import { ENV_PRESETS } from '../lib/envelopePresets'
import { AudioEngine } from '../audio/AudioEngine'
import { DEFAULT_SEQUENCER_STATE, Sequencer } from '../audio/sequencer'
import { midiToFreq } from '../lib/noteUtils'
import {
  BANK_COUNT,
  defaultFx,
  loadBanksFromStorage,
  makeInitialBanks,
  patchFromToneBank,
  persistBanksToStorage,
  serializeBanks,
  deserializeBanks,
  toneBankFromPatch,
  type BanksState,
  type SeqBank,
  type ToneBank,
} from '../lib/banks'

// 波形エディタの UI 状態。ステップ切替で WaveformEditor が unmount されても保持したいため store に置く。
type WaveEditorMode = 'draw' | 'formula'

// ホールド演奏中（同じ鍵を押すまで音が止まらないモード）の状態。
// 全 step で共有することで step 遷移しても音が継続する。
// AudioEngine.setSustainOverride により step ごとの bypass 設定を上書きしてフルチェーン再生にする。
type PlaySustain = {
  midi: number
  withSequencer: boolean
} | null

type SynthStore = {
  patch: SynthPatch
  step: StepId
  audioReady: boolean
  currentFreq: number | null
  // Step1 のプリセット選択マーカー（undefined = 手書き/数式編集中）
  activePresetKey: string | undefined
  // Step2 のエンベロープ プリセット選択マーカー（undefined = カスタム編集中）
  activeEnvelopePresetKey: string | undefined
  // 波形エディタのモードと数式入力テキスト
  waveEditorMode: WaveEditorMode
  waveEditorFormula: string
  // バンク機能（音色 5 + シーケンサー 5）と「最後に読み込んだバンク」マーカー
  banks: BanksState
  activeToneBank: number | null  // 0..BANK_COUNT-1
  activeSeqBank: number | null
  // すべての Keyboard コンポーネントで共有する「ホールド演奏」と「シーケンサー駆動」のトグル状態。
  // 各 Keyboard ヘッダーから操作。
  keyboardHold: boolean
  sequencerEnabled: boolean
  // 現在のホールド演奏（非 null なら音が鳴り続けている）。
  playSustain: PlaySustain
  setStep: (s: StepId) => void
  setWavetable: (w: Float32Array) => void
  setEnvelope: (e: Partial<Envelope>) => void
  setCutoff: (hz: number) => void
  setFilterType: (t: FilterType) => void
  setFilterQ: (q: number) => void
  setFilterEnvelope: (p: Partial<FilterEnvelope>) => void
  setLfo: (p: Partial<LfoParams>) => void
  setLfo2: (p: Partial<LfoParams>) => void
  setFxEnabled: (id: FxId, enabled: boolean) => void
  setFxParam: (id: FxId, name: string, value: number) => void
  moveFx: (id: FxId, direction: 'up' | 'down') => void
  setSequencerConfig: (p: Partial<Omit<SequencerState, 'steps'>>) => void
  setSeqStep: (index: number, partial: Partial<SeqStep>) => void
  setCurrentFreq: (hz: number | null) => void
  setActivePresetKey: (key: string | undefined) => void
  setActiveEnvelopePresetKey: (key: string | undefined) => void
  setWaveEditorMode: (m: WaveEditorMode) => void
  setWaveEditorFormula: (f: string) => void
  loadToneBank: (index: number) => void
  saveToneBank: (index: number) => void
  loadSeqBank: (index: number) => void
  saveSeqBank: (index: number) => void
  clearBank: (kind: 'tone' | 'seq', index: number) => void
  exportBanksAsJson: () => string
  importBanksFromJson: (json: string) => void
  resetBanksToDemo: () => void
  resetPatch: () => void
  markAudioReady: () => void
  // ----- ホールド演奏 / シーケンサー トグル -----
  setKeyboardHold: (v: boolean) => void
  setSequencerEnabled: (v: boolean) => void
  /** ホールド演奏を開始（現在の sequencerEnabled を採用）。同じ midi を渡すと停止する。 */
  startSustain: (midi: number) => void
  /** 演奏中の根音を別の midi に切替（withSequencer の現状は維持）。 */
  switchSustainRoot: (midi: number) => void
  /** ホールド演奏を停止（バナーの停止ボタン、もしくは同じ鍵タップ時）。 */
  stopSustain: () => void
}

// 初期パッチをファクトリ化（リセット用に毎回新しいインスタンスが必要）。
// FxChainState は banks.ts の defaultFx と共有する（値の二重管理を避けるため）。
function makeInitialPatch(): SynthPatch {
  return {
    wavetable: getPreset('sine').generate(),
    envelope: { ...ENV_PRESETS[0].envelope }, // ピアノ風
    filter: { cutoff: 12000, type: 'lowpass', q: 0.0001 },
    filterEnvelope: { enabled: false, attack: 0.01, decay: 0.4, sustain: 0.0, release: 0.3, depth: 3000 },
    lfo: { enabled: false, waveform: 'sine', rate: 5, depth: 0.3, target: 'amp' },
    lfo2: { enabled: false, waveform: 'triangle', rate: 3, depth: 0.3, target: 'filter' },
    fx: defaultFx(),
    sequencer: { ...DEFAULT_SEQUENCER_STATE, steps: DEFAULT_SEQUENCER_STATE.steps.map((s) => ({ ...s })) },
  }
}

const initialPatch: SynthPatch = makeInitialPatch()

const initialBanks: BanksState = loadBanksFromStorage()

export const useSynthStore = create<SynthStore>((set, get) => ({
  patch: initialPatch,
  step: 1,
  audioReady: false,
  currentFreq: null,
  activePresetKey: 'sine',
  activeEnvelopePresetKey: 'piano',
  waveEditorMode: 'draw',
  waveEditorFormula: 'sin(x)',
  banks: initialBanks,
  activeToneBank: null,
  activeSeqBank: null,
  keyboardHold: false,
  sequencerEnabled: false,
  playSustain: null,

  setStep: (s) => set({ step: s }),

  setWavetable: (w) => {
    const patch = { ...get().patch, wavetable: w }
    set({ patch })
    AudioEngine.setWavetable(w)
  },

  setEnvelope: (e) => {
    const envelope = { ...get().patch.envelope, ...e }
    const patch = { ...get().patch, envelope }
    set({ patch })
    AudioEngine.setEnvelope(envelope)
  },

  setCutoff: (hz) => {
    const filter = { ...get().patch.filter, cutoff: hz }
    const patch = { ...get().patch, filter }
    set({ patch })
    AudioEngine.setCutoff(hz)
  },

  setFilterType: (t) => {
    const filter = { ...get().patch.filter, type: t }
    const patch = { ...get().patch, filter }
    set({ patch })
    AudioEngine.setFilterType(t)
  },

  setFilterQ: (q) => {
    const filter = { ...get().patch.filter, q }
    const patch = { ...get().patch, filter }
    set({ patch })
    AudioEngine.setFilterQ(q)
  },

  setFilterEnvelope: (p) => {
    const filterEnvelope = { ...get().patch.filterEnvelope, ...p }
    const patch = { ...get().patch, filterEnvelope }
    set({ patch })
    AudioEngine.setFilterEnvelope(p)
  },

  setLfo: (p) => {
    const lfo = { ...get().patch.lfo, ...p }
    const patch = { ...get().patch, lfo }
    set({ patch })
    AudioEngine.setLfo(p)
  },

  setLfo2: (p) => {
    const lfo2 = { ...get().patch.lfo2, ...p }
    const patch = { ...get().patch, lfo2 }
    set({ patch })
    AudioEngine.setLfo2(p)
  },

  setFxEnabled: (id, enabled) => {
    const prevFx = get().patch.fx
    const fx: FxChainState = {
      ...prevFx,
      fx: { ...prevFx.fx, [id]: { ...prevFx.fx[id], enabled } },
    }
    set({ patch: { ...get().patch, fx } })
    AudioEngine.setFxEnabled(id, enabled)
  },

  setFxParam: (id, name, value) => {
    const prevFx = get().patch.fx
    const params = { ...prevFx.fx[id].params, [name]: value }
    const fx: FxChainState = {
      ...prevFx,
      fx: { ...prevFx.fx, [id]: { ...prevFx.fx[id], params } },
    }
    set({ patch: { ...get().patch, fx } })
    AudioEngine.setFxParam(id, name, value)
  },

  moveFx: (id, direction) => {
    const prevFx = get().patch.fx
    const idx = prevFx.order.indexOf(id)
    if (idx < 0) return
    const swap = direction === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= prevFx.order.length) return
    const order = [...prevFx.order]
    ;[order[idx], order[swap]] = [order[swap], order[idx]]
    const fx: FxChainState = { ...prevFx, order }
    set({ patch: { ...get().patch, fx } })
    AudioEngine.setFxOrder(order)
  },

  setSequencerConfig: (p) => {
    const sequencer: SequencerState = { ...get().patch.sequencer, ...p }
    set({ patch: { ...get().patch, sequencer } })
    Sequencer.setConfig(sequencer)
  },

  setSeqStep: (index, partial) => {
    const prev = get().patch.sequencer
    if (index < 0 || index >= prev.steps.length) return
    const steps = prev.steps.map((s, i) => (i === index ? { ...s, ...partial } : s))
    const sequencer: SequencerState = { ...prev, steps }
    set({ patch: { ...get().patch, sequencer } })
    Sequencer.setConfig(sequencer)
  },

  setCurrentFreq: (hz) => set({ currentFreq: hz }),

  setActivePresetKey: (key) => set({ activePresetKey: key }),

  setActiveEnvelopePresetKey: (key) => set({ activeEnvelopePresetKey: key }),

  setWaveEditorMode: (m) => set({ waveEditorMode: m }),

  setWaveEditorFormula: (f) => set({ waveEditorFormula: f }),

  loadToneBank: (index) => {
    if (index < 0 || index >= BANK_COUNT) return
    const bank = get().banks.tone[index]
    if (!bank) return  // 空バンクは無視
    const patch: SynthPatch = patchFromToneBank(bank, get().patch.sequencer)
    set({
      patch,
      activePresetKey: bank.ui.activePresetKey,
      activeEnvelopePresetKey: bank.ui.activeEnvelopePresetKey,
      waveEditorMode: bank.ui.waveEditorMode ?? 'draw',
      waveEditorFormula: bank.ui.waveEditorFormula ?? 'sin(x)',
      activeToneBank: index,
    })
    AudioEngine.applyPatch(patch)
  },

  saveToneBank: (index) => {
    if (index < 0 || index >= BANK_COUNT) return
    const s = get()
    const label = s.banks.tone[index]?.label ?? `バンク ${index + 1}`
    const next: ToneBank = toneBankFromPatch(
      s.patch,
      {
        activePresetKey: s.activePresetKey,
        activeEnvelopePresetKey: s.activeEnvelopePresetKey,
        waveEditorMode: s.waveEditorMode,
        waveEditorFormula: s.waveEditorFormula,
      },
      label,
    )
    const tone = [...s.banks.tone]
    tone[index] = next
    const banks: BanksState = { ...s.banks, tone }
    set({ banks, activeToneBank: index })
    persistBanksToStorage(banks)
  },

  loadSeqBank: (index) => {
    if (index < 0 || index >= BANK_COUNT) return
    const bank = get().banks.seq[index]
    if (!bank) return
    const sequencer: SequencerState = {
      ...bank.sequencer,
      steps: bank.sequencer.steps.map((st) => ({ ...st })),
    }
    set({ patch: { ...get().patch, sequencer }, activeSeqBank: index })
    Sequencer.setConfig(sequencer)
  },

  saveSeqBank: (index) => {
    if (index < 0 || index >= BANK_COUNT) return
    const s = get()
    const label = s.banks.seq[index]?.label ?? `バンク ${index + 1}`
    const next: SeqBank = {
      label,
      sequencer: { ...s.patch.sequencer, steps: s.patch.sequencer.steps.map((st) => ({ ...st })) },
    }
    const seq = [...s.banks.seq]
    seq[index] = next
    const banks: BanksState = { ...s.banks, seq }
    set({ banks, activeSeqBank: index })
    persistBanksToStorage(banks)
  },

  clearBank: (kind, index) => {
    if (index < 0 || index >= BANK_COUNT) return
    const s = get()
    if (kind === 'tone') {
      const tone = [...s.banks.tone]
      tone[index] = null
      const banks: BanksState = { ...s.banks, tone }
      set({ banks, activeToneBank: s.activeToneBank === index ? null : s.activeToneBank })
      persistBanksToStorage(banks)
    } else {
      const seq = [...s.banks.seq]
      seq[index] = null
      const banks: BanksState = { ...s.banks, seq }
      set({ banks, activeSeqBank: s.activeSeqBank === index ? null : s.activeSeqBank })
      persistBanksToStorage(banks)
    }
  },

  exportBanksAsJson: () => serializeBanks(get().banks),

  importBanksFromJson: (json) => {
    const banks = deserializeBanks(json)
    set({ banks, activeToneBank: null, activeSeqBank: null })
    persistBanksToStorage(banks)
  },

  resetBanksToDemo: () => {
    const banks = makeInitialBanks()
    set({ banks, activeToneBank: null, activeSeqBank: null })
    persistBanksToStorage(banks)
  },

  resetPatch: () => {
    const patch = makeInitialPatch()
    set({
      patch,
      activePresetKey: 'sine',
      activeEnvelopePresetKey: 'piano',
      waveEditorMode: 'draw',
      waveEditorFormula: 'sin(x)',
      activeToneBank: null,
      activeSeqBank: null,
    })
    AudioEngine.applyPatch(patch)
    Sequencer.setConfig(patch.sequencer)
  },

  markAudioReady: () => set({ audioReady: true }),

  // ----- ホールド演奏 / シーケンサー トグル -----

  setKeyboardHold: (v) => {
    set({ keyboardHold: v })
    // ホールド OFF にした瞬間、もし演奏中なら停止する（鳴りっぱなし事故防止）
    if (!v) get().stopSustain()
  },

  setSequencerEnabled: (v) => {
    const prev = get()
    set({ sequencerEnabled: v })
    const cur = prev.playSustain
    if (!cur) return
    // 演奏中にトグルした場合は再生モードを乗り換える
    if (v && !cur.withSequencer) {
      // 単音 → シーケンサー: noteOff してから setRoot
      AudioEngine.noteOff()
      Sequencer.setRoot(cur.midi)
      set({ playSustain: { ...cur, withSequencer: true } })
    } else if (!v && cur.withSequencer) {
      // シーケンサー → 単音: setRoot(null) してから noteOn
      Sequencer.setRoot(null)
      AudioEngine.noteOn(midiToFreq(cur.midi))
      set({ playSustain: { ...cur, withSequencer: false } })
    }
  },

  startSustain: (midi) => {
    const s = get()
    const cur = s.playSustain
    // 同じ鍵が再押下されたら停止
    if (cur && cur.midi === midi) {
      get().stopSustain()
      return
    }
    // 別の鍵 → 切替
    if (cur) {
      get().switchSustainRoot(midi)
      return
    }
    // 新規開始: フルチェーンを保証してから音を出す
    AudioEngine.setSustainOverride(true)
    const withSeq = s.sequencerEnabled
    if (withSeq) {
      Sequencer.setRoot(midi)
    } else {
      AudioEngine.noteOn(midiToFreq(midi))
    }
    set({ playSustain: { midi, withSequencer: withSeq }, currentFreq: midiToFreq(midi) })
  },

  switchSustainRoot: (midi) => {
    const cur = get().playSustain
    if (!cur) return
    if (cur.withSequencer) {
      Sequencer.setRoot(midi)
    } else {
      AudioEngine.noteOn(midiToFreq(midi))  // re-attack
    }
    set({ playSustain: { ...cur, midi }, currentFreq: midiToFreq(midi) })
  },

  stopSustain: () => {
    const cur = get().playSustain
    if (!cur) return
    if (cur.withSequencer) {
      Sequencer.setRoot(null)
    } else {
      AudioEngine.noteOff()
    }
    // sustain override 解除 → 各 step が要求していた bypass 値が実際に効くようになる
    AudioEngine.setSustainOverride(false)
    set({ playSustain: null, currentFreq: null })
  },
}))
