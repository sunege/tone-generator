import { useEffect, useRef } from 'react'

type Props = {
  wavetable: Float32Array
  height?: number
  title?: string
}

export function WaveformDisplay({ wavetable, height = 180, title = '波形' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
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

    // axes
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    // waveform
    ctx.strokeStyle = '#0ea5e9'
    ctx.lineWidth = 2
    ctx.beginPath()
    const N = wavetable.length
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w
      const y = h / 2 - wavetable[i] * (h / 2) * 0.9
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [wavetable, height])

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-lab-mute">{title}</div>
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
    </div>
  )
}
