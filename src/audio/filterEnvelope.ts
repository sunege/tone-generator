import type { FilterEnvelope } from '../types'

// フィルター用 ADSR を additive モジュレーションのゲイン値（filterEnvDepth.gain）に書く。
// 音量 ADSR（envelope.ts）とは独立だが、release 時の anchor 問題を回避するため
// 同じ「JS 側で envelope 状態を追跡」アプローチを取る。
//
// 値域は Hz（depth）。0..1 の正規化ではなくそのまま filter.frequency に加算される。
// 線形ランプを使う（cutoff は Hz 単位での加算なので 0 を扱える必要があり、exp は使えない）。

const FE_QUICK_RESET = 0.002

type FEAttackInfo = {
  attackStart: number
  attackEnd: number
  decayEnd: number
  peak: number       // depth (Hz, バイポーラ)
  sustainValue: number // depth * sustainLevel (Hz)
}
let lastAttack: FEAttackInfo | null = null

function envelopeValueAt(info: FEAttackInfo, ctxTime: number): number {
  if (ctxTime <= info.attackStart) return 0
  if (ctxTime < info.attackEnd) {
    const t = (ctxTime - info.attackStart) / (info.attackEnd - info.attackStart)
    return info.peak * t
  }
  if (ctxTime < info.decayEnd) {
    const t = (ctxTime - info.attackEnd) / (info.decayEnd - info.attackEnd)
    return info.peak + (info.sustainValue - info.peak) * t
  }
  return info.sustainValue
}

export function triggerFilterAttack(gain: AudioParam, env: FilterEnvelope, ctxTime: number) {
  const a = Math.max(0.001, env.attack)
  const d = Math.max(0.001, env.decay)
  const s = Math.max(0, Math.min(1, env.sustain))
  const peak = env.depth
  const sustainValue = peak * s

  gain.cancelScheduledValues(ctxTime)
  gain.setValueAtTime(0, ctxTime)
  // Attack 始点は必ず 0 から（前回 release が残っていてもここで強制リセット）
  gain.linearRampToValueAtTime(0, ctxTime + FE_QUICK_RESET)
  // Attack: 0 → peak
  gain.linearRampToValueAtTime(peak, ctxTime + FE_QUICK_RESET + a)
  // Decay: peak → sustain
  gain.linearRampToValueAtTime(sustainValue, ctxTime + FE_QUICK_RESET + a + d)

  lastAttack = {
    attackStart: ctxTime + FE_QUICK_RESET,
    attackEnd: ctxTime + FE_QUICK_RESET + a,
    decayEnd: ctxTime + FE_QUICK_RESET + a + d,
    peak,
    sustainValue,
  }
}

export function triggerFilterRelease(gain: AudioParam, env: FilterEnvelope, ctxTime: number) {
  const r = Math.max(0.005, env.release)
  const currentValue = lastAttack ? envelopeValueAt(lastAttack, ctxTime) : 0
  gain.cancelScheduledValues(ctxTime)
  gain.setValueAtTime(currentValue, ctxTime)
  gain.linearRampToValueAtTime(0, ctxTime + r)
  lastAttack = null
}

// 強制的に 0 にリセット（enable=false 切替時 / バイパス時に使用）
export function resetFilterEnvelope(gain: AudioParam, ctxTime: number) {
  gain.cancelScheduledValues(ctxTime)
  gain.setTargetAtTime(0, ctxTime, 0.01)
  lastAttack = null
}
