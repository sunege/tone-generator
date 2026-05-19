import type { Envelope } from '../types'

export type EnvPresetKey = 'piano' | 'organ' | 'strings' | 'percussion'

export type EnvPreset = {
  key: EnvPresetKey
  label: string
  description: string
  envelope: Envelope
}

export const ENV_PRESETS: EnvPreset[] = [
  {
    key: 'piano',
    label: 'ピアノ風',
    description: '立ち上がりが速く、ゆっくり減衰する',
    envelope: { attack: 0.005, decay: 0.6, sustain: 0.2, release: 0.4 },
  },
  {
    key: 'organ',
    label: 'オルガン風',
    description: '押している間は一定の大きさで鳴り続ける',
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.1 },
  },
  {
    key: 'strings',
    label: '弦楽器風',
    description: '立ち上がりがゆっくりで、余韻が残る',
    envelope: { attack: 0.3, decay: 0.2, sustain: 0.8, release: 0.6 },
  },
  {
    key: 'percussion',
    label: '打楽器風',
    description: '一瞬で立ち上がり、すぐに消える',
    envelope: { attack: 0.001, decay: 0.15, sustain: 0.0, release: 0.05 },
  },
]
