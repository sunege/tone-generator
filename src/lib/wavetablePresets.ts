import { WAVETABLE_SIZE } from '../types'

export type PresetKey =
  | 'sine'
  | 'square'
  | 'triangle'
  | 'sawtooth'
  | 'clarinet'
  | 'metallic'

export type Preset = {
  key: PresetKey
  label: string
  description: string
  generate: () => Float32Array
}

const N = WAVETABLE_SIZE
const TAU = Math.PI * 2

function fromHarmonics(amps: number[]): Float32Array {
  const out = new Float32Array(N)
  let max = 0
  for (let i = 0; i < N; i++) {
    const x = (i / N) * TAU
    let v = 0
    for (let h = 0; h < amps.length; h++) {
      v += amps[h] * Math.sin((h + 1) * x)
    }
    out[i] = v
    if (Math.abs(v) > max) max = Math.abs(v)
  }
  if (max > 0) {
    for (let i = 0; i < N; i++) out[i] /= max
  }
  return out
}

export const PRESETS: Preset[] = [
  {
    key: 'sine',
    label: '正弦波',
    description: '基本波。倍音を一切含まないなめらかな音',
    generate: () => {
      const out = new Float32Array(N)
      for (let i = 0; i < N; i++) out[i] = Math.sin((i / N) * TAU)
      return out
    },
  },
  {
    key: 'square',
    label: '矩形波',
    description: '奇数倍音が豊富。明るくブザー的な音',
    generate: () => {
      const out = new Float32Array(N)
      for (let i = 0; i < N; i++) out[i] = i < N / 2 ? 1 : -1
      return out
    },
  },
  {
    key: 'triangle',
    label: '三角波',
    description: '矩形波より柔らかく、奇数倍音が急速に弱くなる',
    generate: () => {
      const out = new Float32Array(N)
      for (let i = 0; i < N; i++) {
        const t = i / N
        out[i] = t < 0.5 ? -1 + 4 * t : 3 - 4 * t
      }
      return out
    },
  },
  {
    key: 'sawtooth',
    label: 'ノコギリ波',
    description: '全ての倍音を含み、明るくにぎやかな音',
    generate: () => {
      const out = new Float32Array(N)
      for (let i = 0; i < N; i++) out[i] = 1 - 2 * (i / N)
      return out
    },
  },
  {
    key: 'clarinet',
    label: 'クラリネット風',
    description: '奇数倍音中心。木管楽器のような落ち着いた音',
    generate: () => fromHarmonics([1.0, 0.0, 0.75, 0.0, 0.5, 0.0, 0.14, 0.0, 0.5, 0.0, 0.12, 0.0, 0.17]),
  },
  {
    key: 'metallic',
    label: '金属音風',
    description: '高次倍音を強調。金属を叩いたような硬い音',
    generate: () => fromHarmonics([1.0, 0.8, 0.6, 0.9, 0.5, 0.7, 0.4, 0.6, 0.3, 0.5, 0.2, 0.4]),
  },
]

export function getPreset(key: PresetKey): Preset {
  const p = PRESETS.find((x) => x.key === key)
  if (!p) throw new Error(`Unknown preset: ${key}`)
  return p
}
