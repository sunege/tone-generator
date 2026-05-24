import { useEffect, useRef, useState } from 'react'
import { WAVETABLE_SIZE } from '../types'
import { parseFormulaToWavetable } from '../lib/formulaParser'
import { useSynthStore } from '../store/synthStore'

type Props = {
  wavetable: Float32Array
  onChange: (w: Float32Array) => void
  height?: number
  /** 参考用に薄く重ね描きする波形（マイクキャプチャのなぞりガイドなど） */
  overlayWavetable?: Float32Array | null
}

export function WaveformEditor({ wavetable, onChange, height = 240, overlayWavetable }: Props) {
  // モード・数式入力は store 経由で永続化（ステップ切替で unmount されても消えないように）
  const mode = useSynthStore((s) => s.waveEditorMode)
  const setMode = useSynthStore((s) => s.setWaveEditorMode)
  const formula = useSynthStore((s) => s.waveEditorFormula)
  const setFormula = useSynthStore((s) => s.setWaveEditorFormula)
  const [formulaError, setFormulaError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastIdxRef = useRef<number | null>(null)
  // 直近の wavetable のミュータブルコピー（ドラッグ中は edit する）
  const workingRef = useRef<Float32Array>(wavetable)

  // 描画
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

    // grid
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()
    ctx.beginPath()
    for (let i = 1; i < 8; i++) {
      const x = (w * i) / 8
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
    }
    ctx.strokeStyle = '#f1f5f9'
    ctx.stroke()

    // overlay (なぞりガイド) - メインより先に描いて下層に置く
    if (overlayWavetable && overlayWavetable.length > 0) {
      const ON = overlayWavetable.length
      ctx.strokeStyle = '#f97316'
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      for (let i = 0; i < ON; i++) {
        const x = (i / (ON - 1)) * w
        const y = h / 2 - overlayWavetable[i] * (h / 2) * 0.95
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    // waveform
    const N = wavetable.length
    ctx.strokeStyle = '#0ea5e9'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w
      const y = h / 2 - wavetable[i] * (h / 2) * 0.95
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [wavetable, height, overlayWavetable])

  // wavetable プロップが変わったら作業用バッファを同期
  useEffect(() => {
    workingRef.current = new Float32Array(wavetable)
  }, [wavetable])

  const writePoint = (clientX: number, clientY: number) => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const xRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const yRatio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    const idx = Math.min(WAVETABLE_SIZE - 1, Math.floor(xRatio * WAVETABLE_SIZE))
    const value = (0.5 - yRatio) * 2 / 0.95 // canvas で 0.95 倍にスケールしているので逆スケール
    const clamped = Math.max(-1, Math.min(1, value))

    const buf = workingRef.current
    if (lastIdxRef.current !== null && lastIdxRef.current !== idx) {
      // 線形補間で間を埋める
      const fromIdx = lastIdxRef.current
      const fromVal = buf[fromIdx]
      const lo = Math.min(fromIdx, idx)
      const hi = Math.max(fromIdx, idx)
      const loVal = fromIdx === lo ? fromVal : clamped
      const hiVal = fromIdx === lo ? clamped : fromVal
      for (let i = lo; i <= hi; i++) {
        const t = (i - lo) / Math.max(1, hi - lo)
        buf[i] = loVal * (1 - t) + hiVal * t
      }
    } else {
      buf[idx] = clamped
    }
    lastIdxRef.current = idx
    onChange(new Float32Array(buf))
  }

  // iOS Safari では canvas 上で setPointerCapture を呼ぶと後続イベントが失われる
  // 既知のバグがあるため使用しない。代わりに pointerleave/cancel でドラッグを止め、
  // 指が canvas 外に出たら描画を中断する仕様にする。
  const handlePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'draw') return
    drawingRef.current = true
    lastIdxRef.current = null
    writePoint(e.clientX, e.clientY)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return
    writePoint(e.clientX, e.clientY)
  }
  const handlePointerUp = () => {
    drawingRef.current = false
    lastIdxRef.current = null
  }

  const applyFormula = () => {
    const result = parseFormulaToWavetable(formula)
    if (result.ok) {
      setFormulaError(null)
      onChange(result.wavetable)
    } else {
      setFormulaError(result.error)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('draw')}
          className={`rounded-full px-3 py-1 text-sm ${mode === 'draw' ? 'bg-lab-accent text-white' : 'bg-slate-100 text-lab-mute hover:bg-slate-200'}`}
        >
          ✏️ 手書きモード
        </button>
        <button
          onClick={() => setMode('formula')}
          className={`rounded-full px-3 py-1 text-sm ${mode === 'formula' ? 'bg-lab-accent text-white' : 'bg-slate-100 text-lab-mute hover:bg-slate-200'}`}
        >
          📐 数式モード
        </button>
      </div>

      <div className="rounded-lg border border-lab-line bg-white p-3">
        <div className="mb-2 text-xs font-semibold text-lab-mute">
          {mode === 'draw' ? '波形エディタ (ドラッグで描画)' : '波形エディタ (プレビュー)'}
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, touchAction: 'none', cursor: mode === 'draw' ? 'crosshair' : 'default' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {mode === 'formula' && (
        <div className="space-y-2 rounded-lg border border-lab-line bg-white p-3">
          <label className="text-xs font-semibold text-lab-mute">数式 (x は 0〜2π)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFormula()
              }}
              className="flex-1 rounded border border-lab-line px-3 py-2 font-mono text-sm focus:border-lab-accent focus:outline-none"
              placeholder="例: sin(x) + 0.5 * sin(2*x)"
            />
            <button
              onClick={applyFormula}
              className="rounded bg-lab-accent px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              適用
            </button>
          </div>
          {formulaError && <div className="text-xs text-red-600">{formulaError}</div>}
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            {['sin(x)', 'sin(x)+0.5*sin(2*x)', 'sin(x)+0.3*sin(3*x)+0.2*sin(5*x)', 'sin(x)^3'].map((ex) => (
              <button
                key={ex}
                onClick={() => setFormula(ex)}
                className="rounded bg-slate-100 px-2 py-1 font-mono text-lab-mute hover:bg-slate-200"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
