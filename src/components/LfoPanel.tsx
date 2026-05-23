import type { LfoParams, LfoTarget, LfoWaveform } from '../types'

const LFO_WAVEFORMS: { key: LfoWaveform; label: string }[] = [
  { key: 'sine', label: '正弦' },
  { key: 'triangle', label: '三角' },
  { key: 'sawtooth', label: 'ノコギリ' },
  { key: 'square', label: '矩形' },
]

const LFO_TARGETS: { key: LfoTarget; label: string; description: string }[] = [
  { key: 'amp', label: '音量 (トレモロ)', description: '振幅を周期的に揺らす' },
  { key: 'filter', label: 'フィルター (ワウ)', description: 'カットオフを周期的に揺らす' },
  { key: 'pitch', label: 'ピッチ (ビブラート)', description: '音程を周期的に揺らす' },
]

// LFO rate: 0.1〜20Hz の対数スライダー
const R_MIN = 0.1
const R_MAX = 20
const rLogMin = Math.log10(R_MIN)
const rLogMax = Math.log10(R_MAX)
const toRateSlider = (hz: number) => (Math.log10(Math.max(R_MIN, Math.min(R_MAX, hz))) - rLogMin) / (rLogMax - rLogMin)
const fromRateSlider = (v: number) => Math.pow(10, rLogMin + v * (rLogMax - rLogMin))

type Props = {
  title: string                                  // 例: "LFO 1"
  lfo: LfoParams
  onChange: (partial: Partial<LfoParams>) => void
}

/**
 * 単一 LFO スロットの UI。LFO1 / LFO2 で再利用する。
 * 行き先（target）が他スロットと同じでも、AudioEngine 側で additive に合成される。
 */
export function LfoPanel({ title, lfo, onChange }: Props) {
  return (
    <div className="space-y-3 rounded-lg border border-lab-line bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-lab-ink">{title}（低周波揺らぎ）</div>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={lfo.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="accent-lab-accent"
          />
          <span className={lfo.enabled ? 'font-semibold text-lab-ink' : 'text-lab-mute'}>
            {lfo.enabled ? 'ON' : 'OFF'}
          </span>
        </label>
      </div>

      <div className={`space-y-3 ${lfo.enabled ? '' : 'opacity-50'}`}>
        <div className="space-y-1">
          <div className="text-xs font-semibold text-lab-mute">行き先 (modulation target)</div>
          <div className="flex flex-wrap gap-2">
            {LFO_TARGETS.map((t) => {
              const active = lfo.target === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => onChange({ target: t.key })}
                  disabled={!lfo.enabled}
                  title={t.description}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    active
                      ? 'bg-lab-accent font-semibold text-white'
                      : 'bg-slate-100 text-lab-mute hover:bg-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-lab-mute">波形</div>
          <div className="flex flex-wrap gap-2">
            {LFO_WAVEFORMS.map((w) => {
              const active = lfo.waveform === w.key
              return (
                <button
                  key={w.key}
                  onClick={() => onChange({ waveform: w.key })}
                  disabled={!lfo.enabled}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    active
                      ? 'bg-lab-accent font-semibold text-white'
                      : 'bg-slate-100 text-lab-mute hover:bg-slate-200'
                  }`}
                >
                  {w.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-lab-mute">レート</span>
            <span className="font-mono text-lab-ink">{lfo.rate.toFixed(2)} Hz</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={toRateSlider(lfo.rate)}
            onChange={(e) => onChange({ rate: fromRateSlider(parseFloat(e.target.value)) })}
            disabled={!lfo.enabled}
            className="w-full accent-lab-accent"
          />
          <div className="flex justify-between text-[10px] text-lab-mute">
            <span>0.1Hz</span><span>1Hz</span><span>5Hz</span><span>20Hz</span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-lab-mute">深さ</span>
            <span className="font-mono text-lab-ink">{(lfo.depth * 100).toFixed(0)} %</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={lfo.depth}
            onChange={(e) => onChange({ depth: parseFloat(e.target.value) })}
            disabled={!lfo.enabled}
            className="w-full accent-lab-accent"
          />
        </div>
      </div>
    </div>
  )
}
