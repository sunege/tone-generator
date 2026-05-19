import type { Envelope } from '../types'

const MIN = 0.0001
// クリック回避用の極短ランプ秒。Attack 始点を MIN に揃えるのに使う。
const QUICK_RESET = 0.002

// 既存の automation を ctxTime の時点の「実際の」値で凍結する。
// cancelAndHoldAtTime は ctxTime に正しい automation 値をアンカーとして残してくれるため、
// この後 setValueAtTime で上書きしてはいけない（上書きすると保持値を失う）。
// 注意: AudioParam.value ゲッターは「最後に明示的に set した値」しか返さず、
// 進行中の linear/exponential ramp の途中値は返さない。よって gain.value に頼ると
// 古い値で anchor を潰してしまい、Release ランプが MIN→MIN になって無音化する。
function holdAt(gain: AudioParam, ctxTime: number) {
  const g = gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }
  if (typeof g.cancelAndHoldAtTime === 'function') {
    g.cancelAndHoldAtTime(ctxTime)
  } else {
    // フォールバック: 古いブラウザ向け。ramp 途中の精度は劣るが致命的ではない
    gain.cancelScheduledValues(ctxTime)
    gain.setValueAtTime(Math.max(MIN, gain.value), ctxTime)
  }
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
  //    既に MIN なら聞こえないが、release 進行中などで gain が大きい場合も 2ms で滑らかに
  //    MIN まで落とすのでクリック音は発生しない。
  gain.linearRampToValueAtTime(MIN, ctxTime + QUICK_RESET)
  // 3) Attack: MIN → peak
  gain.linearRampToValueAtTime(peak, ctxTime + QUICK_RESET + a)
  // 4) Decay: peak → sustain
  gain.exponentialRampToValueAtTime(s, ctxTime + QUICK_RESET + a + d)
}

export function triggerRelease(gain: AudioParam, env: Envelope, ctxTime: number) {
  const r = Math.max(0.005, env.release)
  holdAt(gain, ctxTime)
  // holdAt の anchor をそのまま起点として expRamp で MIN まで減衰。
  // setValueAtTime を挟むと anchor を gain.value (古い値) で上書きしてしまうので呼ばない。
  gain.exponentialRampToValueAtTime(MIN, ctxTime + r)
}
