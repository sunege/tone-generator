import type { Envelope } from '../types'

const MIN = 0.0001
// クリック回避用の極短ランプ秒。Attack 始点を MIN に揃えるのに使う。
const QUICK_RESET = 0.002

// Attack 時の JS 側エンベロープ追跡情報。
// Release 時に「今この時点のゲインはどこか」を JS 側で計算するために保持する。
// なぜ必要か:
//   sustain に完全到達した（decay ramp 完了後）状態で Release を発火すると、Chrome の
//   cancelAndHoldAtTime は anchor を正しく立てられないことがある（過去の ramp イベントの
//   終端を超えているケース）。anchor が立たないまま exponentialRampToValueAtTime を打つと
//   始点が MIN になり、Release が MIN→MIN ランプ＝即無音化＝プツッと切れて聞こえる。
//   そこで AudioParam の状態を信用せず、エンベロープ進行を独自に追跡して setValueAtTime で
//   明示的にアンカーする。
//
// ポリフォニック化に伴い、この情報は voice ごとに別管理する必要があるため
// module-level の単一変数ではなく、呼び出し側（Voice）が保持する形に refactor。
export type AttackInfo = {
  attackStart: number  // 実 Attack 開始 ctxTime（QUICK_RESET 終了時点）
  attackEnd: number    // 実 Attack 終了 ctxTime
  decayEnd: number     // Decay 終了（= Sustain 開始）ctxTime
  peak: number
  sustain: number
}

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

/**
 * ADSR Attack を発火し、AttackInfo を返す。
 * 呼び出し側は返り値を voice ごとに保持し、triggerRelease に渡す。
 */
export function triggerAttack(gain: AudioParam, env: Envelope, ctxTime: number): AttackInfo {
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

  return {
    attackStart: ctxTime + QUICK_RESET,
    attackEnd: ctxTime + QUICK_RESET + a,
    decayEnd: ctxTime + QUICK_RESET + a + d,
    peak,
    sustain: s,
  }
}

/**
 * ADSR Release を発火。Attack 時に取得した info を渡すことで sustain 完全到達後でも
 * 正しい現在値から ramp できる（cancelAndHoldAtTime バグ回避）。
 */
export function triggerRelease(gain: AudioParam, env: Envelope, ctxTime: number, info: AttackInfo | null) {
  const r = Math.max(0.005, env.release)
  const currentGain = info ? Math.max(MIN, envelopeValueAt(info, ctxTime)) : MIN
  gain.cancelScheduledValues(ctxTime)
  gain.setValueAtTime(currentGain, ctxTime)
  gain.exponentialRampToValueAtTime(MIN, ctxTime + r)
}
