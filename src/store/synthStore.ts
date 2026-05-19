import { create } from 'zustand'
import type { Envelope, SynthPatch, StepId } from '../types'
import { getPreset } from '../lib/wavetablePresets'
import { ENV_PRESETS } from '../lib/envelopePresets'
import { AudioEngine } from '../audio/AudioEngine'

type SynthStore = {
  patch: SynthPatch
  step: StepId
  audioReady: boolean
  currentFreq: number | null
  setStep: (s: StepId) => void
  setWavetable: (w: Float32Array) => void
  setEnvelope: (e: Partial<Envelope>) => void
  setCutoff: (hz: number) => void
  setCurrentFreq: (hz: number | null) => void
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

  markAudioReady: () => set({ audioReady: true }),
}))
