import { useSynthStore } from '../store/synthStore'
import { FFTDisplay } from '../components/FFTDisplay'
import { Oscilloscope } from '../components/Oscilloscope'
import { HintList } from '../components/Hint'
import { AudioEngine } from '../audio/AudioEngine'
import { useCallback, useEffect, useState } from 'react'

const TEST_FREQ = 440

// 対数スライダー: 20Hz〜20kHz を 0..1 にマッピング
const F_MIN = 20
const F_MAX = 20000
const logMin = Math.log10(F_MIN)
const logMax = Math.log10(F_MAX)
const toSlider = (hz: number) => (Math.log10(Math.max(F_MIN, Math.min(F_MAX, hz))) - logMin) / (logMax - logMin)
const fromSlider = (v: number) => Math.pow(10, logMin + v * (logMax - logMin))

export function Step3Filter() {
  const cutoff = useSynthStore((s) => s.patch.filter.cutoff)
  const setCutoff = useSynthStore((s) => s.setCutoff)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  const [playing, setPlaying] = useState(false)
  // ADSR は OFF（連続トーンの方がフィルター効果を観察しやすい）
  const [applyEnvelope, setApplyEnvelope] = useState(false)
  // フィルターは ON（Step3 はフィルター学習なので原則 ON）
  const [applyFilter, setApplyFilter] = useState(true)

  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  // バイパス設定を state に同期
  useEffect(() => {
    AudioEngine.setEnvelopeBypass(!applyEnvelope)
  }, [applyEnvelope])

  useEffect(() => {
    AudioEngine.setFilterBypass(!applyFilter)
  }, [applyFilter])

  // 画面遷移時に発音とバイパスを解除。
  // ホールド演奏中は noteOff / setCurrentFreq(null) をスキップして step 跨ぎの継続再生を維持。
  useEffect(() => {
    return () => {
      const sustaining = useSynthStore.getState().playSustain !== null
      if (!sustaining) {
        AudioEngine.noteOff()
        setCurrentFreq(null)
      }
      AudioEngine.setEnvelopeBypass(false)
      AudioEngine.setFilterBypass(false)
    }
  }, [setCurrentFreq])

  const toggle = () => {
    if (playing) {
      AudioEngine.noteOff()
      setPlaying(false)
    } else {
      AudioEngine.noteOn(TEST_FREQ)
      setCurrentFreq(TEST_FREQ)
      setPlaying(true)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 3 · フィルターで音色を変えよう</h2>
        <p className="mt-1 text-sm text-lab-mute">
          ローパスフィルターのカットオフ周波数より上の成分を弱めます。
        </p>
      </header>

      <HintList
        items={[
          '高い周波数を減らすと柔らかい音になります',
          'こもった音は高周波成分が少ない状態です',
          'カットオフを上げると元の音に近づき、下げるとくぐもった音になります',
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={toggle}
          className={`inline-flex h-10 w-64 items-center justify-center rounded-full text-sm font-semibold text-white shadow transition ${
            playing ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'
          }`}
        >
          {playing ? '■ 停止' : '▶ 440Hz で連続再生'}
        </button>

        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs">
          <span className="px-2 text-lab-mute">ADSR</span>
          <button
            onClick={() => setApplyEnvelope(false)}
            className={`rounded-full px-3 py-1 transition ${
              !applyEnvelope ? 'bg-white font-semibold text-lab-ink shadow' : 'text-lab-mute hover:text-lab-ink'
            }`}
          >
            OFF
          </button>
          <button
            onClick={() => setApplyEnvelope(true)}
            className={`rounded-full px-3 py-1 transition ${
              applyEnvelope ? 'bg-white font-semibold text-lab-ink shadow' : 'text-lab-mute hover:text-lab-ink'
            }`}
          >
            ON
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs">
          <span className="px-2 text-lab-mute">フィルター</span>
          <button
            onClick={() => setApplyFilter(false)}
            className={`rounded-full px-3 py-1 transition ${
              !applyFilter ? 'bg-white font-semibold text-lab-ink shadow' : 'text-lab-mute hover:text-lab-ink'
            }`}
          >
            OFF
          </button>
          <button
            onClick={() => setApplyFilter(true)}
            className={`rounded-full px-3 py-1 transition ${
              applyFilter ? 'bg-white font-semibold text-lab-ink shadow' : 'text-lab-mute hover:text-lab-ink'
            }`}
          >
            ON
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-lab-line bg-white p-4">
        <label className="block text-xs font-semibold text-lab-mute">カットオフ周波数</label>
        <div className="mt-2 flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={toSlider(cutoff)}
            onChange={(e) => setCutoff(fromSlider(parseFloat(e.target.value)))}
            className="flex-1 accent-lab-accent"
            disabled={!applyFilter}
          />
          <span className="w-24 text-right font-mono text-sm">
            {cutoff >= 1000 ? `${(cutoff / 1000).toFixed(2)} kHz` : `${cutoff.toFixed(0)} Hz`}
          </span>
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-lab-mute">
          <span>20Hz</span>
          <span>200Hz</span>
          <span>2kHz</span>
          <span>20kHz</span>
        </div>
        {!applyFilter && (
          <p className="mt-2 text-xs text-amber-700">フィルターは OFF 中。スライダーで値は保存されますが音には反映されません</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Oscilloscope
          getAnalyser={AudioEngine.getAnalyserPre}
          getFrequency={getFrequency}
          title="フィルター前 波形（オシロ）"
          color="#64748b"
        />
        <Oscilloscope
          getAnalyser={AudioEngine.getAnalyserPost}
          getFrequency={getFrequency}
          title="フィルター後 波形（オシロ）"
          color="#f97316"
        />
        <FFTDisplay
          getAnalyser={AudioEngine.getAnalyserPre}
          title="フィルター前 FFT"
          color="#64748b"
        />
        <FFTDisplay
          getAnalyser={AudioEngine.getAnalyserPost}
          title="フィルター後 FFT"
          color="#f97316"
        />
      </div>
    </div>
  )
}
