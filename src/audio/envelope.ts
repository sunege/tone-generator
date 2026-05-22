import type { Envelope } from '../types'

const MIN = 0.0001
// クリック回避用の極短ランプ秒。Attack 始点を MIN に揃えるのに使う。
const QUICK_RESET = 0.002

// 直近の Attack 情報。Release 時に「今この時点のゲインはどこか」を JS 側で計算するために保持する。
// なぜ必要か:
//   sustain に完全到達した（decay ramp 完了後）状態で Release を発火すると、Chrome の
//   cancelAndHoldAtTime は anchor を正しく立てられないことがある（過去の ramp イベントの
//   終端を超えているケース）。anchor が立たないまま exponentialRampToValueAtTime を打つと
//   始点が MIN になり、Release が MIN→MIN ランプ＝即無音化＝プツッと切れて聞こえる。
//   そこで AudioParam の状態を信用せず、エンベロープ進行を独自に追跡して setValueAtTime で
//   明示的にアンカーする。
type AttackInfo = {
  attackStart: number  // 実 Attack 開始 ctxTime（QUICK_RESET 終了時点）
  attackEnd: number    // 実 Attack 終了 ctxTime
  decayEnd: number     // Decay 終了（= Sustain 開始）ctxTime
  peak: number
  sustain: number
}
let lastAttack: AttackInfo | null = null

// 既存の automation を ctxTime の時点の「実際の」値で凍結する。
// cancelAndHoldAtTime はランプ進行中なら正しい automation 値を anchor として残してくれるが、
// 全イベント終了後（sustain 安定中など）には anchor を立て損ねるケースがある。
// そのため Release 側では別途 setValueAtTime で明示アンカーする。
function holdAt(gain: AudioParam, ctxTime: number) {
  const g = gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
  if (typeof g.cancelAndHoldAtTime === 'function') {
    g.cancelAndHoldAtTime(ctxTime)
  } else {
    gain.cancelScheduledValues(ctxTime)
    gain.setValueAtTime(Math.max(MIN, gain.value), ctxTime)
  }
}

// AttackInfo から ctxTime 時点のゲイン推定値を算出する。
function envelopeValueAt(info: AttackInfo, ctxTime: number): number {
  if (ctxTime <= info.attackStart) return MIN
  if (ctxTime < info.attackEnd) {
    // Attack: MIN → peak の線形
    const t = (ctxTime - info.attackStart) / (info.attackEnd - info.attackStart)
    return MIN + (info.peak - MIN) * t
  }
  if (ctxTime < info.decayEnd) {
    // Decay: peak → sustain の指数
    const t = (ctxTime - info.attackEnd) / (info.decayEnd - info.attackEnd)
    return info.peak * Math.pow(info.sustain / info.peak, t)
  }
  // Sustain 安定中
  return info.sustain
}

export function triggerAttack(gain: AudioParam, env: Envelope, ctxTime: number) {
  const peak = 1
  const a = Math.max(0.001, env.attack)
  const d = Math.max(0.001, env.decay)
  const s = Math.max(MIN, Math.min(1, env.sustain))

  // 1) 既存 automation を ctxTime で凍結
  holdAt(gain, ctxTime)
  // 2) Attack 始点を MIN に揃える（2ms の極短ランプ）。
  //    これがないと、cancelAndHoldAtTime に「過去のイベント」が無い状態（初回 attack や
  //    release が完全に終わっている状態）で anchor が暗黙的にしか立たず、Chrome では
  //    続く linearRamp の起点が不定値になり「Attack が途中から始まる」現象が起きる。
  gain.linearRampToValueAtTime(MIN, ctxTime + QUICK_RESET)
  // 3) Attack: MIN → peak
  gain.linearRampToValueAtTime(peak, ctxTime + QUICK_RESET + a)
  // 4) Decay: peak → sustain
  gain.exponentialRampToValueAtTime(s, ctxTime + QUICK_RESET + a + d)

  lastAttack = {
    attackStart: ctxTime + QUICK_RESET,
    attackEnd: ctxTime + QUICK_RESET + a,
    decayEnd: ctxTime + QUICK_RESET + a + d,
    peak,
    sustain: s,
  }
}

export function triggerRelease(gain: AudioParam, env: Envelope, ctxTime: number) {
  const r = Math.max(0.005, env.release)
  // JS 側で追跡したエンベロープ状態から ctxTime 時点のゲインを計算し、それを明示的に anchor。
  // cancelAndHoldAtTime に依存しないため、sustain 完全到達後の Release も正しく減衰する。
  const currentGain = lastAttack
    ? Math.max(MIN, envelopeValueAt(lastAttack, ctxTime))
    : MIN
  gain.cancelScheduledValues(ctxTime)
  gain.setValueAtTime(currentGain, ctxTime)
  gain.exponentialRampToValueAtTime(MIN, ctxTime + r)
  lastAttack = null
}
