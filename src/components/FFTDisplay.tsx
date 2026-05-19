import { useEffect, useRef } from 'react'

type Props = {
  getAnalyser: () => AnalyserNode | null
  height?: number
  title?: string
  color?: string
}

export function FFTDisplay({ getAnalyser, height = 180, title = 'FFTスペクトル', color = '#f97316' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const dataRef = useRef<Float32Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1

    const draw = () => {
      const analyser = getAnalyser()
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

      // baseline
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h - 1)
      ctx.lineTo(w, h - 1)
      ctx.stroke()

      if (!analyser) {
        ctx.fillStyle = '#94a3b8'
        ctx.font = '12px sans-serif'
        ctx.fillText('音を出すとスペクトルが表示されます', 8, 18)
      } else {
        const bins = analyser.frequencyBinCount
        if (!dataRef.current || dataRef.current.length !== bins) {
          dataRef.current = new Float32Array(new ArrayBuffer(bins * 4))
        }
        const data = dataRef.current
        analyser.getFloatFrequencyData(data)
        const sr = analyser.context.sampleRate
        const nyquist = sr / 2

        // 対数軸: 20Hz - nyquist
        const fMin = 20
        const fMax = Math.min(nyquist, 16000)
        const logMin = Math.log10(fMin)
        const logMax = Math.log10(fMax)

        // 棒グラフ風: 各 x ピクセルに対応する周波数を求めて、binをマップ
        ctx.fillStyle = color
        const dbMin = -90
        const dbMax = -10
        for (let x = 0; x < w; x++) {
          const f = Math.pow(10, logMin + (x / w) * (logMax - logMin))
          const bin = Math.min(bins - 1, Math.round((f / nyquist) * bins))
          const db = data[bin]
          const norm = Math.max(0, Math.min(1, (db - dbMin) / (dbMax - dbMin)))
          const barH = norm * (h - 4)
          ctx.fillRect(x, h - 1 - barH, 1, barH)
        }

        // 目盛り (100Hz, 1kHz, 10kHz)
        ctx.fillStyle = '#94a3b8'
        ctx.font = '10px sans-serif'
        ;[100, 1000, 10000].forEach((mark) => {
          if (mark < fMin || mark > fMax) return
          const x = ((Math.log10(mark) - logMin) / (logMax - logMin)) * w
          ctx.fillRect(x, h - 4, 1, 4)
          ctx.fillText(mark >= 1000 ? `${mark / 1000}k` : `${mark}`, x + 2, h - 6)
        })
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [getAnalyser, height, color])

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-lab-mute">{title}</div>
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
    </div>
  )
}
