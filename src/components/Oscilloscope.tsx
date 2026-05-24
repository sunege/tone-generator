import { useEffect, useRef } from 'react'

type Props = {
  getAnalyser: () => AnalyserNode | null
  getFrequency: () => number | null
  height?: number
  title?: string
  color?: string
}

// 「描画継続するか」をヒステリシスで判定するための 2 段しきい値。
// 単一しきい値だと release tail / FX 反響中に peak がしきい値付近を上下して
// フレームごとに描画 ON/OFF が切り替わり、見た目がちらつく問題があった。
//   - peak ≥ ON しきい値: 「鳴っている」状態に入る／継続
//   - peak < OFF しきい値: 「無音」状態に入る／継続
//   - 中間値（デッドゾーン）: 直前の状態を維持する
// これで release 末端のフラフラした peak でも状態切替が抑制され、ちらつきが消える。
const SILENCE_THRESHOLD_ON = 0.0010   // 約 -60dB FS。ここを超えたら描画開始
const SILENCE_THRESHOLD_OFF = 0.0003  // 約 -70dB FS。ここを下回ったら描画停止
// 横軸は A3 (220Hz) の 1 周期で固定。約 4.55ms。
// これで高い音ほど多くの波長が画面に収まり、波長の短さが視覚的にわかる。
const REFERENCE_FREQ = 220

/**
 * オシロスコープ風に固定時間窓で波形を同期表示する。
 * - getFloatTimeDomainData で時間領域バッファを取得
 * - 横軸窓は A3 1周期分のサンプル数で固定（音の高さでは変化しない）
 * - 負→正のゼロクロスをトリガーとし、線形補間で sub-sample 精度で位置決定
 *   → ジッタを抑え、画面上で波形が静止しているように見える
 * - エンベロープによる振幅変化はそのまま反映されるので時間変化が観察できる
 */
export function Oscilloscope({
  getAnalyser,
  getFrequency,
  height = 180,
  title = '演奏中の波形（オシロ）',
  color = '#0ea5e9',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const bufRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  // 最後に観測した有効な再生周波数。鍵盤を離したあとや FX 反響中に
  // ページ側が currentFreq=null を渡してきても、トリガ同期のため記憶しておく。
  const lastFreqRef = useRef<number | null>(null)
  // ヒステリシス用「現在 audible か」状態。release tail でのちらつき防止。
  const isAudibleRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1

    const drawCenterLine = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()
    }

    const draw = () => {
      const analyser = getAnalyser()
      const currentFreq = getFrequency()
      // 現在 freq が有効なら記憶。null/0 のときは前回値で代用する。
      if (currentFreq != null && currentFreq > 0) {
        lastFreqRef.current = currentFreq
      }
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = height
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      drawCenterLine(ctx, w, h)

      let label = '—'

      if (!analyser) {
        if (labelRef.current) labelRef.current.textContent = label
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const N = analyser.fftSize
      if (!bufRef.current || bufRef.current.length !== N) {
        bufRef.current = new Float32Array(new ArrayBuffer(N * 4))
      }
      const buf = bufRef.current
      analyser.getFloatTimeDomainData(buf)

      // 振幅ピーク → ヒステリシスで「audible 状態」を更新。
      // 単純な単一しきい値だと release 末端で peak がしきい値前後を行き来して
      // ちらつきの原因になるため、ON / OFF で別のしきい値を使う。
      let peak = 0
      for (let i = 0; i < N; i++) {
        const v = Math.abs(buf[i])
        if (v > peak) peak = v
      }
      if (isAudibleRef.current) {
        if (peak < SILENCE_THRESHOLD_OFF) isAudibleRef.current = false
      } else {
        if (peak >= SILENCE_THRESHOLD_ON) isAudibleRef.current = true
      }
      if (!isAudibleRef.current) {
        if (labelRef.current) labelRef.current.textContent = label
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      // トリガ同期に使う周波数: 現在値 → 直前の有効値 → A3 フォールバック
      const triggerFreq = (currentFreq && currentFreq > 0)
        ? currentFreq
        : (lastFreqRef.current ?? REFERENCE_FREQ)

      const sr = analyser.context.sampleRate
      const windowSpp = sr / REFERENCE_FREQ // 固定窓 (A3 1周期分)
      const currentSpp = sr / triggerFreq    // 現在音の1周期 (波長カウント用)

      // トリガー: 負→正のゼロクロス。線形補間で sub-sample 精度を確保
      const searchEnd = Math.max(1, Math.floor(N - windowSpp - 1))
      let trigger = -1
      for (let i = 1; i < searchEnd; i++) {
        if (buf[i - 1] <= 0 && buf[i] > 0) {
          const frac = -buf[i - 1] / (buf[i] - buf[i - 1] || 1e-9)
          trigger = i - 1 + frac
          break
        }
      }
      if (trigger < 0) trigger = 0

      // 描画
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let x = 0; x < w; x++) {
        const t = trigger + (x / (w - 1)) * windowSpp
        const i0 = Math.floor(t)
        const i1 = Math.min(N - 1, i0 + 1)
        const frac = t - i0
        const s = buf[i0] * (1 - frac) + buf[i1] * frac
        const y = h / 2 - Math.max(-1, Math.min(1, s)) * (h / 2) * 0.95
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      const wavelengths = windowSpp / currentSpp
      if (currentFreq && currentFreq > 0) {
        label = `${currentFreq.toFixed(1)} Hz · 約 ${wavelengths.toFixed(2)} 波長`
      } else {
        // Release/Delay 反響中: 鍵盤は離されているが音は鳴っている
        label = `余韻中 · ${triggerFreq.toFixed(1)} Hz 基準`
      }
      if (labelRef.current) labelRef.current.textContent = label

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [getAnalyser, getFrequency, height, color])

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 flex h-5 items-baseline justify-between gap-2 overflow-hidden">
        <span className="truncate text-xs font-semibold text-lab-mute">{title}</span>
        <span ref={labelRef} className="shrink-0 whitespace-nowrap font-mono text-[10px] text-lab-mute">—</span>
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
    </div>
  )
}
