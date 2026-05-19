import { useRef } from 'react'
import type { Envelope } from '../types'

type Props = {
  envelope: Envelope
  onChange: (patch: Partial<Envelope>) => void
  height?: number
}

const MAX_A = 2.0
const MAX_D = 2.0
const MAX_R = 4.0
const SUSTAIN_HOLD = 0.5 // 表示上のサスティン保持時間（秒）

export function EnvelopeEditor({ envelope, onChange, height = 200 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef<null | 'a' | 'd' | 's' | 'r'>(null)

  const totalTime = MAX_A + MAX_D + SUSTAIN_HOLD + MAX_R
  const xScale = (sec: number) => (sec / totalTime) * 1000 // 0..1000 viewBox
  const yScale = (level: number) => (1 - level) * 200      // 0..200 viewBox

  const aX = xScale(envelope.attack)
  const dX = xScale(envelope.attack + envelope.decay)
  const sX = xScale(envelope.attack + envelope.decay + SUSTAIN_HOLD)
  const rX = xScale(envelope.attack + envelope.decay + SUSTAIN_HOLD + envelope.release)

  const peakY = yScale(1)
  const sY = yScale(envelope.sustain)
  const endY = yScale(0)

  const handlePointerDown = (target: 'a' | 'd' | 's' | 'r') => (e: React.PointerEvent<SVGCircleElement>) => {
    draggingRef.current = target
    ;(e.target as SVGCircleElement).setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = draggingRef.current
    if (!target) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const secFromStart = xRatio * totalTime
    const level = 1 - yRatio

    if (target === 'a') {
      const newA = Math.max(0.001, Math.min(MAX_A, secFromStart))
      onChange({ attack: newA })
    } else if (target === 'd') {
      const newD = Math.max(0.001, Math.min(MAX_D, secFromStart - envelope.attack))
      onChange({ decay: newD })
    } else if (target === 's') {
      onChange({ sustain: Math.max(0, Math.min(1, level)) })
    } else if (target === 'r') {
      const after = envelope.attack + envelope.decay + SUSTAIN_HOLD
      const newR = Math.max(0.005, Math.min(MAX_R, secFromStart - after))
      onChange({ release: newR })
    }
  }
  const handlePointerUp = () => {
    draggingRef.current = null
  }

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-lab-mute">ADSRエンベロープ（点をドラッグで調整）</div>
      <svg
        ref={svgRef}
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
        style={{ width: '100%', height, touchAction: 'none' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <rect x={0} y={0} width={1000} height={200} fill="#fafbfd" />
        {/* baseline */}
        <line x1={0} y1={endY} x2={1000} y2={endY} stroke="#e2e8f0" strokeWidth={1} />
        {/* curve */}
        <polyline
          fill="rgba(14,165,233,0.15)"
          stroke="#0ea5e9"
          strokeWidth={2}
          points={`0,${endY} ${aX},${peakY} ${dX},${sY} ${sX},${sY} ${rX},${endY}`}
        />
        {/* labels */}
        <text x={aX / 2} y={195} textAnchor="middle" fontSize="10" fill="#64748b">A</text>
        <text x={(aX + dX) / 2} y={195} textAnchor="middle" fontSize="10" fill="#64748b">D</text>
        <text x={(dX + sX) / 2} y={195} textAnchor="middle" fontSize="10" fill="#64748b">S</text>
        <text x={(sX + rX) / 2} y={195} textAnchor="middle" fontSize="10" fill="#64748b">R</text>
        {/* draggable points */}
        <DragHandle cx={aX} cy={peakY} onPointerDown={handlePointerDown('a')} color="#0ea5e9" />
        <DragHandle cx={dX} cy={sY} onPointerDown={handlePointerDown('d')} color="#0ea5e9" />
        <DragHandle cx={sX} cy={sY} onPointerDown={handlePointerDown('s')} color="#f97316" />
        <DragHandle cx={rX} cy={endY} onPointerDown={handlePointerDown('r')} color="#0ea5e9" />
      </svg>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SliderField label="Attack (秒)" value={envelope.attack} min={0.001} max={MAX_A} step={0.001} onChange={(v) => onChange({ attack: v })} />
        <SliderField label="Decay (秒)" value={envelope.decay} min={0.001} max={MAX_D} step={0.001} onChange={(v) => onChange({ decay: v })} />
        <SliderField label="Sustain" value={envelope.sustain} min={0} max={1} step={0.01} onChange={(v) => onChange({ sustain: v })} />
        <SliderField label="Release (秒)" value={envelope.release} min={0.005} max={MAX_R} step={0.005} onChange={(v) => onChange({ release: v })} />
      </div>
    </div>
  )
}

function DragHandle({
  cx,
  cy,
  color,
  onPointerDown,
}: {
  cx: number
  cy: number
  color: string
  onPointerDown: (e: React.PointerEvent<SVGCircleElement>) => void
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="transparent" onPointerDown={onPointerDown} style={{ cursor: 'grab' }} />
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="white" strokeWidth={2} pointerEvents="none" />
    </g>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="space-y-1 text-xs text-lab-mute">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-lab-ink">{value.toFixed(3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-lab-accent"
      />
    </label>
  )
}
