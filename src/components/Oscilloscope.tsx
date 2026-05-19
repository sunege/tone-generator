import { useEffect, useRef } from 'react'

type Props = {
  getAnalyser: () => AnalyserNode | null
  getFrequency: () => number | null
  height?: number
  title?: string
  color?: string
}

const SILENCE_THRESHOLD = 0.005
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
      const freq = getFrequency()
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

      // 振幅が極小なら静音とみなしフラット表示
      let peak = 0
      for (let i = 0; i < N; i++) {
        const v = Math.abs(buf[i])
        if (v > peak) peak = v
      }
      if (peak < SILENCE_THRESHOLD || freq == null || freq <= 0) {
        if (labelRef.current) labelRef.current.textContent = label
        rafRef.current = requestAnimationFrame(draw)
        return
      }

      const sr = analyser.context.sampleRate
      const windowSpp = sr / REFERENCE_FREQ // 固定窓 (A3 1周期分)
      const currentSpp = sr / freq           // 現在音の1周期 (波長カウント用)

      // トリガー: 負→正のゼロクロス。線形補間で sub-sample 精度を確保
      // 探索範囲: 後ろに 1 窓分残してバッファ前半を見る
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

      // 描画: w ピクセルに対して windowSpp サンプルを線形補間でマップ
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let x = 0; x < w; x++) {
        const t = trigger + (x / (w - 1)) * windowSpp
        const i0 = Math.floor(t)
        const i1 = Math.min(N - 1, i0 + 1)
        const frac = t - i0
        const s = buf[i0] * (1 - frac) + buf[i1] * frac
        // 表示は ±1 までを 95% に収めて余白
        const y = h / 2 - Math.max(-1, Math.min(1, s)) * (h / 2) * 0.95
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      const wavelengths = windowSpp / currentSpp
      label = `${freq.toFixed(1)} Hz · 約 ${wavelengths.toFixed(2)} 波長`
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
