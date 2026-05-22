import { create } from 'zustand'
import type { Envelope, FilterEnvelope, FilterType, FxChainState, FxId, LfoParams, SynthPatch, StepId } from '../types'
import { getPreset } from '../lib/wavetablePresets'
import { ENV_PRESETS } from '../lib/envelopePresets'
import { AudioEngine } from '../audio/AudioEngine'

// 波形エディタの UI 状態。ステップ切替で WaveformEditor が unmount されても保持したいため store に置く。
type WaveEditorMode = 'draw' | 'formula'

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
  setStep: (s: StepId) => void
  setWavetable: (w: Float32Array) => void
  setEnvelope: (e: Partial<Envelope>) => void
  setCutoff: (hz: number) => void
  setFilterType: (t: FilterType) => void
  setFilterQ: (q: number) => void
  setFilterEnvelope: (p: Partial<FilterEnvelope>) => void
  setLfo: (p: Partial<LfoParams>) => void
  setFxEnabled: (id: FxId, enabled: boolean) => void
  setFxParam: (id: FxId, name: string, value: number) => void
  moveFx: (id: FxId, direction: 'up' | 'down') => void
  setCurrentFreq: (hz: number | null) => void
  setActivePresetKey: (key: string | undefined) => void
  setActiveEnvelopePresetKey: (key: string | undefined) => void
  setWaveEditorMode: (m: WaveEditorMode) => void
  setWaveEditorFormula: (f: string) => void
  markAudioReady: () => void
}

const initialFx: FxChainState = {
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

const initialPatch: SynthPatch = {
  wavetable: getPreset('sine').generate(),
  envelope: ENV_PRESETS[0].envelope, // ピアノ風
  filter: { cutoff: 12000, type: 'lowpass', q: 0.0001 },
  filterEnvelope: { enabled: false, attack: 0.01, decay: 0.4, sustain: 0.0, release: 0.3, depth: 3000 },
  lfo: { enabled: false, waveform: 'sine', rate: 5, depth: 0.3, target: 'amp' },
  fx: initialFx,
}

export const useSynthStore = create<SynthStore>((set, get) => ({
  patch: initialPatch,
  step: 1,
  audioReady: false,
  currentFreq: null,
  activePresetKey: 'sine',
  activeEnvelopePresetKey: 'piano',
  waveEditorMode: 'draw',
  waveEditorFormula: 'sin(x)',

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

  setCurrentFreq: (hz) => set({ currentFreq: hz }),

  setActivePresetKey: (key) => set({ activePresetKey: key }),

  setActiveEnvelopePresetKey: (key) => set({ activeEnvelopePresetKey: key }),

  setWaveEditorMode: (m) => set({ waveEditorMode: m }),

  setWaveEditorFormula: (f) => set({ waveEditorFormula: f }),

  markAudioReady: () => set({ audioReady: true }),
}))
