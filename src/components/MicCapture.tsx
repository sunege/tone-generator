import { useEffect, useMemo, useRef, useState } from 'react'
import { MicSource } from '../audio/MicSource'
import { AudioEngine } from '../audio/AudioEngine'
import { detectPitch } from '../lib/pitchDetect'
import { extractRange } from '../lib/extractPeriod'
import { midiToName } from '../lib/noteUtils'
import { WAVETABLE_SIZE } from '../types'

type Props = {
  onTransfer: (wt: Float32Array) => void
  onOverlay: (wt: Float32Array | null) => void
  overlayActive: boolean
}

type Captured = {
  raw: Float32Array         // フルキャプチャバッファ
  sampleRate: number
  start: number             // 切り出し開始サンプル
  end: number               // 切り出し終了サンプル
}

const LIVE_HEIGHT = 120
const PREVIEW_HEIGHT = 120
const WIDE_HEIGHT = 160
const MARKER_HIT_TOL = 14 // px

function freqToNoteName(freq: number): string {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440))
  return midiToName(midi)
}

export function MicCapture({ onTransfer, onOverlay, overlayActive }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captured, setCaptured] = useState<Captured | null>(null)

  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const wideCanvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const smoothedPeakRef = useRef(0.1)
  const dragRef = useRef<'start' | 'end' | null>(null)

  // マーカーから抽出した1周期波形（プレビュー & 転送 & オーバーレイで使用）
  const extracted = useMemo(() => {
    if (!captured) return null
    return extractRange(captured.raw, captured.start, captured.end, WAVETABLE_SIZE)
  }, [captured])

  const markerFreq = captured ? captured.sampleRate / Math.max(1, captured.end - captured.start) : null
  const markerPeriodMs = captured ? ((captured.end - captured.start) / captured.sampleRate) * 1000 : 0

  // ----- ライブ波形描画（オートゲイン） -----
  useEffect(() => {
    if (!enabled) return
    const analyser = MicSource.getAnalyser()
    const canvas = liveCanvasRef.current
    if (!analyser || !canvas) return
    const dpr = window.devicePixelRatio || 1
    const N = analyser.fftSize
    const buf = new Float32Array(new ArrayBuffer(N * 4))

    const draw = () => {
      analyser.getFloatTimeDomainData(buf)
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = LIVE_HEIGHT
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      let peak = 0
      for (let i = 0; i < N; i++) {
        const a = Math.abs(buf[i])
        if (a > peak) peak = a
      }
      const prev = smoothedPeakRef.current
      const next = peak > prev ? peak : prev * 0.9 + peak * 0.1
      smoothedPeakRef.current = Math.max(0.02, next)
      const scale = 0.9 / smoothedPeakRef.current

      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()

      ctx.strokeStyle = '#0ea5e9'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * N)
        const v = Math.max(-1, Math.min(1, buf[i] * scale))
        const y = h / 2 - v * (h / 2)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      ctx.fillStyle = '#94a3b8'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`×${scale.toFixed(1)}`, w - 4, 12)
      ctx.textAlign = 'left'

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [enabled])

  // ----- 抽出プレビュー描画 -----
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !extracted) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = PREVIEW_HEIGHT
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 2
    ctx.beginPath()
    const N = extracted.length
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w
      const y = h / 2 - extracted[i] * (h / 2) * 0.95
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }, [extracted])

  // ----- ワイド波形（フルキャプチャ + マーカー）描画 -----
  useEffect(() => {
    const canvas = wideCanvasRef.current
    if (!canvas || !captured) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = WIDE_HEIGHT
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const N = captured.raw.length
    const startX = (captured.start / N) * w
    const endX = (captured.end / N) * w

    // 範囲外を薄く塗る
    ctx.fillStyle = 'rgba(148,163,184,0.12)'
    ctx.fillRect(0, 0, startX, h)
    ctx.fillRect(endX, 0, w - endX, h)
    // 範囲内をうっすら着色
    ctx.fillStyle = 'rgba(249,115,22,0.06)'
    ctx.fillRect(startX, 0, endX - startX, h)

    // 中心線
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()

    // 波形（バッファのピークでスケーリング）
    let peak = 0
    for (let i = 0; i < N; i++) {
      const a = Math.abs(captured.raw[i])
      if (a > peak) peak = a
    }
    const scale = peak > 0 ? 0.9 / peak : 1
    ctx.strokeStyle = '#0ea5e9'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * N)
      const v = Math.max(-1, Math.min(1, captured.raw[i] * scale))
      const y = h / 2 - v * (h / 2)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // マーカー描画
    const drawMarker = (x: number, color: string, label: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.setLineDash([])
      // ハンドル（上下）
      ctx.fillStyle = color
      ctx.fillRect(x - 6, 0, 12, 10)
      ctx.fillRect(x - 6, h - 10, 12, 10)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(label, x, 8)
      ctx.fillText(label, x, h - 2)
      ctx.textAlign = 'left'
    }
    drawMarker(startX, '#10b981', 'S')
    drawMarker(endX, '#ef4444', 'E')
  }, [captured])

  // ----- マーカードラッグ -----
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!captured) return
    const canvas = wideCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const startX = (captured.start / captured.raw.length) * rect.width
    const endX = (captured.end / captured.raw.length) * rect.width
    const distStart = Math.abs(x - startX)
    const distEnd = Math.abs(x - endX)
    if (distStart < MARKER_HIT_TOL && distStart <= distEnd) {
      dragRef.current = 'start'
    } else if (distEnd < MARKER_HIT_TOL) {
      dragRef.current = 'end'
    } else {
      return
    }
    canvas.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!captured || !dragRef.current) return
    const canvas = wideCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const sampleIdx = Math.round((x / rect.width) * captured.raw.length)
    if (dragRef.current === 'start') {
      const newStart = Math.max(0, Math.min(captured.end - 4, sampleIdx))
      setCaptured({ ...captured, start: newStart })
    } else {
      const newEnd = Math.max(captured.start + 4, Math.min(captured.raw.length - 1, sampleIdx))
      setCaptured({ ...captured, end: newEnd })
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragRef.current && wideCanvasRef.current) {
      try {
        wideCanvasRef.current.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    dragRef.current = null
  }

  // ----- マイク制御 -----
  const enable = async () => {
    setRequesting(true)
    setError(null)
    try {
      await MicSource.enable()
      setEnabled(true)
    } catch (e) {
      setError(`マイクの取得に失敗しました: ${(e as Error).message || '不明なエラー'}`)
    } finally {
      setRequesting(false)
    }
  }

  const disable = () => {
    MicSource.disable()
    setEnabled(false)
    setCaptured(null)
    onOverlay(null)
  }

  // ----- キャプチャ -----
  const capture = () => {
    const buf = MicSource.getRecentBuffer()
    const ctx = AudioEngine.getContext()
    if (!buf || !ctx) {
      setError('マイクからデータを取得できませんでした')
      return
    }
    setError(null)
    const sr = ctx.sampleRate
    const N = buf.length
    // 初期マーカー: ピッチ検出が成功すれば最初のゼロクロスから1周期分、失敗時はバッファ中央付近
    const freq = detectPitch(buf, sr)
    let start = Math.floor(N * 0.25)
    let end = Math.floor(N * 0.5)
    if (freq !== null) {
      const period = sr / freq
      // 最初の負→正ゼロクロスを探す
      let trigger = -1
      for (let i = 1; i < N - period; i++) {
        if (buf[i - 1] <= 0 && buf[i] > 0) {
          trigger = i
          break
        }
      }
      if (trigger < 0) trigger = Math.floor(N * 0.25)
      start = trigger
      end = Math.min(N - 1, trigger + Math.round(period))
    }
    setCaptured({ raw: buf, sampleRate: sr, start, end })
  }

  const clear = () => {
    setCaptured(null)
    onOverlay(null)
    setError(null)
  }

  // ----- 画面遷移時にマイク停止 -----
  useEffect(() => {
    return () => {
      MicSource.disable()
      onOverlay(null)
    }
  }, [onOverlay])

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">🎙 マイクから学ぶ</span>
          <button
            onClick={enabled ? disable : enable}
            disabled={requesting}
            className={`inline-flex h-8 items-center rounded-full px-4 text-xs font-semibold text-white shadow transition ${
              enabled ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'
            } disabled:opacity-50`}
          >
            {requesting ? '取得中…' : enabled ? '● マイク ON（クリックで停止）' : '○ マイク OFF（クリックで開始）'}
          </button>
        </div>
        <span className="text-xs text-lab-mute">※ HTTPS または localhost が必要</span>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-lab-line bg-slate-50/40 p-2">
          <div className="mb-1 text-xs font-semibold text-lab-mute">ライブ波形</div>
          {enabled ? (
            <canvas ref={liveCanvasRef} style={{ width: '100%', height: LIVE_HEIGHT }} />
          ) : (
            <div className="flex items-center justify-center text-xs text-lab-mute" style={{ height: LIVE_HEIGHT }}>
              マイクをONにすると表示されます
            </div>
          )}
        </div>

        <div className="rounded-md border border-lab-line bg-slate-50/40 p-2">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-lab-mute">抽出される1周期</span>
            {markerFreq !== null && (
              <span className="font-mono text-[10px] text-lab-mute">
                {markerFreq.toFixed(1)} Hz / {freqToNoteName(markerFreq)}
              </span>
            )}
          </div>
          {extracted ? (
            <canvas ref={previewCanvasRef} style={{ width: '100%', height: PREVIEW_HEIGHT }} />
          ) : (
            <div className="flex items-center justify-center rounded border border-dashed border-lab-line text-xs text-lab-mute" style={{ height: PREVIEW_HEIGHT }}>
              まだキャプチャしていません
            </div>
          )}
        </div>
      </div>

      {captured && (
        <div className="mt-3 rounded-md border border-lab-line bg-slate-50/40 p-2">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-lab-mute">
              📏 キャプチャ全体（緑Sと赤Eのハンドルをドラッグして範囲を調整）
            </span>
            <span className="font-mono text-[10px] text-lab-mute">
              {captured.end - captured.start} sample / {markerPeriodMs.toFixed(2)} ms
              {markerFreq !== null && ` / ${markerFreq.toFixed(1)} Hz`}
            </span>
          </div>
          <canvas
            ref={wideCanvasRef}
            style={{ width: '100%', height: WIDE_HEIGHT, touchAction: 'none', cursor: dragRef.current ? 'ew-resize' : 'pointer' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={capture}
          disabled={!enabled}
          className="rounded-full bg-lab-accent px-4 py-2 text-xs font-semibold text-white shadow hover:bg-sky-600 disabled:bg-slate-300"
        >
          📸 キャプチャ
        </button>
        <button
          onClick={() => extracted && onTransfer(extracted)}
          disabled={!extracted}
          className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-600 disabled:bg-slate-300"
        >
          → 波形エディタに転送
        </button>
        <button
          onClick={() => extracted && onOverlay(overlayActive ? null : extracted)}
          disabled={!extracted}
          className={`rounded-full px-4 py-2 text-xs font-semibold shadow transition disabled:bg-slate-300 disabled:text-white ${
            overlayActive
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
          }`}
        >
          {overlayActive ? '👁 オーバーレイ中（クリックで解除）' : '👁 なぞりガイドとして表示'}
        </button>
        {captured && (
          <button
            onClick={clear}
            className="rounded-full bg-slate-200 px-4 py-2 text-xs font-semibold text-lab-ink shadow hover:bg-slate-300"
          >
            ✕ クリア
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-lab-mute">
        💡 安定した音を出してキャプチャ → 下のワイド波形のマーカー（緑S / 赤E）をドラッグしてちょうど1周期を切り出してください。
        Eが赤、Sが緑。範囲は自動的に1024サンプルにリサンプルされ、転送・オーバーレイで使えます。
      </p>
    </div>
  )
}
