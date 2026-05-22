import { create } from 'zustand'
import type { Envelope, SynthPatch, StepId } from '../types'
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
  setCurrentFreq: (hz: number | null) => void
  setActivePresetKey: (key: string | undefined) => void
  setActiveEnvelopePresetKey: (key: string | undefined) => void
  setWaveEditorMode: (m: WaveEditorMode) => void
  setWaveEditorFormula: (f: string) => void
  markAudioReady: () => void
}

const initialPatch: SynthPatch = {
  wavetable: getPreset('sine').generate(),
  envelope: ENV_PRESETS[0].envelope, // ピアノ風
  filter: { cutoff: 12000 },
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

  setCurrentFreq: (hz) => set({ currentFreq: hz }),

  setActivePresetKey: (key) => set({ activePresetKey: key }),

  setActiveEnvelopePresetKey: (key) => set({ activeEnvelopePresetKey: key }),

  setWaveEditorMode: (m) => set({ waveEditorMode: m }),

  setWaveEditorFormula: (f) => set({ waveEditorFormula: f }),

  markAudioReady: () => set({ audioReady: true }),
}))
