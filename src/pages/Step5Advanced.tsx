import { useCallback, useEffect, useState } from 'react'
import { useSynthStore } from '../store/synthStore'
import { Keyboard } from '../components/Keyboard'
import { LfoPanel } from '../components/LfoPanel'
import { Oscilloscope } from '../components/Oscilloscope'
import { FFTDisplay } from '../components/FFTDisplay'
import { HintList } from '../components/Hint'
import { AudioEngine } from '../audio/AudioEngine'
import type { FilterType } from '../types'

const FILTER_TYPES: { key: FilterType; label: string; description: string }[] = [
  { key: 'lowpass', label: 'ローパス', description: 'カットオフ以上を弱める（こもった音）' },
  { key: 'highpass', label: 'ハイパス', description: 'カットオフ以下を弱める（細い音）' },
  { key: 'bandpass', label: 'バンドパス', description: 'カットオフ周辺だけを通す（鼻音的）' },
]

// 対数スライダー: 20Hz〜20kHz を 0..1 にマッピング
const F_MIN = 20
const F_MAX = 20000
const logMin = Math.log10(F_MIN)
const logMax = Math.log10(F_MAX)
const toFreqSlider = (hz: number) => (Math.log10(Math.max(F_MIN, Math.min(F_MAX, hz))) - logMin) / (logMax - logMin)
const fromFreqSlider = (v: number) => Math.pow(10, logMin + v * (logMax - logMin))

// ピッチベンドの最大幅（cents）。±200 = ±2 semitone（MIDI 標準）
const PITCH_BEND_RANGE = 200

export function Step5Advanced() {
  const filter = useSynthStore((s) => s.patch.filter)
  const filterEnv = useSynthStore((s) => s.patch.filterEnvelope)
  const lfo = useSynthStore((s) => s.patch.lfo)
  const lfo2 = useSynthStore((s) => s.patch.lfo2)
  const setCutoff = useSynthStore((s) => s.setCutoff)
  const setFilterType = useSynthStore((s) => s.setFilterType)
  const setFilterQ = useSynthStore((s) => s.setFilterQ)
  const setFilterEnvelope = useSynthStore((s) => s.setFilterEnvelope)
  const setLfo = useSynthStore((s) => s.setLfo)
  const setLfo2 = useSynthStore((s) => s.setLfo2)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  // ピッチベンドは演奏ジェスチャーなので patch に持たず Step5 のローカル UI 状態
  const [pitchBend, setPitchBend] = useState(0)

  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  const applyPitchBend = (cents: number) => {
    setPitchBend(cents)
    AudioEngine.setPitchBend(cents)
  }

  // 入室時: フィルター適用＋ LFO バイパス解除。退室時: LFO はバイパスして他ステップに漏らさない
  useEffect(() => {
    AudioEngine.setEnvelopeBypass(false)
    AudioEngine.setFilterBypass(false)
    AudioEngine.setLfoBypass(false)
    AudioEngine.setPitchBend(0)
    return () => {
      AudioEngine.noteOff()
      AudioEngine.setEnvelopeBypass(false)
      AudioEngine.setFilterBypass(false)
      AudioEngine.setLfoBypass(true)  // LFO は退室時バイパス（patch 設定自体は保持）
      AudioEngine.setPitchBend(0)     // ピッチベンドは退室時に必ず 0 へ
      setCurrentFreq(null)
    }
  }, [setCurrentFreq])

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 5 · アドバンスドモード</h2>
        <p className="mt-1 text-sm text-lab-mute">
          フィルタータイプ・レゾナンス、LFO（揺らぎ）など、シンセサイザーらしい応用機能を試せます。
        </p>
      </header>

      <HintList
        items={[
          'レゾナンス（Q）を上げるとカットオフ付近が強調されて "クセ" のある音色になります',
          'バンドパスは特定の周波数帯だけを通すので、ワウペダルのような効果を作れます',
          'LFO を音量に当てるとトレモロ、フィルターに当てるとワウ、ピッチに当てるとビブラートになります',
          'LFO は 2 系統用意してあるので、別々の行き先（例: LFO1=amp, LFO2=filter）に同時にかけて複雑な揺らぎを作れます',
          'フィルターエンベロープを正の depth にすると "シュワッ" と立ち上がる音、負にすると "わぁ〜ん" と閉じる音になります',
          'ピッチベンドはホイール風に音程をなめらかに上下できます。LFO ビブラートと併用可能です',
        ]}
      />

      {/*
        Step6 と同じ 2 カラム構成:
          - 左 (2fr): Filter / FilterEnv / LFO×2 / PitchBend を縦並び
          - 右 (1fr): Oscilloscope / FFT を縦スタックで sticky
        lg 未満では 1 列に縦積み（右パネルもインラインで下に来る）。
      */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* 左カラム: 各パラメータ */}
        <div className="space-y-4">

      {/* 行 1: フィルター + フィルターエンベロープ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* フィルター設定 */}
        <div className="space-y-3 rounded-lg border border-lab-line bg-white p-4">
          <div className="text-sm font-semibold text-lab-ink">フィルター</div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-lab-mute">タイプ</div>
            <div className="flex flex-wrap gap-2">
              {FILTER_TYPES.map((t) => {
                const active = filter.type === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setFilterType(t.key)}
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
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-lab-mute">カットオフ</span>
              <span className="font-mono text-lab-ink">
                {filter.cutoff >= 1000 ? `${(filter.cutoff / 1000).toFixed(2)} kHz` : `${filter.cutoff.toFixed(0)} Hz`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={toFreqSlider(filter.cutoff)}
              onChange={(e) => setCutoff(fromFreqSlider(parseFloat(e.target.value)))}
              className="w-full accent-lab-accent"
            />
            <div className="flex justify-between text-[10px] text-lab-mute">
              <span>20Hz</span><span>200Hz</span><span>2kHz</span><span>20kHz</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-lab-mute">レゾナンス (Q)</span>
              <span className="font-mono text-lab-ink">{filter.q.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.0001}
              max={20}
              step={0.01}
              value={filter.q}
              onChange={(e) => setFilterQ(parseFloat(e.target.value))}
              className="w-full accent-lab-accent"
            />
            <div className="flex justify-between text-[10px] text-lab-mute">
              <span>0（平坦）</span><span>10（強）</span><span>20（リング）</span>
            </div>
          </div>
        </div>

        {/* フィルターエンベロープ */}
        <div className="space-y-3 rounded-lg border border-lab-line bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-lab-ink">フィルターエンベロープ</div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={filterEnv.enabled}
                onChange={(e) => setFilterEnvelope({ enabled: e.target.checked })}
                className="accent-lab-accent"
              />
              <span className={filterEnv.enabled ? 'font-semibold text-lab-ink' : 'text-lab-mute'}>
                {filterEnv.enabled ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>

          <div className={`space-y-2 ${filterEnv.enabled ? '' : 'opacity-50'}`}>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-lab-mute">Attack</span>
                  <span className="font-mono text-lab-ink">{filterEnv.attack.toFixed(3)}s</span>
                </div>
                <input
                  type="range"
                  min={0.001}
                  max={3}
                  step={0.001}
                  value={filterEnv.attack}
                  onChange={(e) => setFilterEnvelope({ attack: parseFloat(e.target.value) })}
                  disabled={!filterEnv.enabled}
                  className="w-full accent-lab-accent"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-lab-mute">Decay</span>
                  <span className="font-mono text-lab-ink">{filterEnv.decay.toFixed(3)}s</span>
                </div>
                <input
                  type="range"
                  min={0.001}
                  max={3}
                  step={0.001}
                  value={filterEnv.decay}
                  onChange={(e) => setFilterEnvelope({ decay: parseFloat(e.target.value) })}
                  disabled={!filterEnv.enabled}
                  className="w-full accent-lab-accent"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-lab-mute">Sustain</span>
                  <span className="font-mono text-lab-ink">{filterEnv.sustain.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={filterEnv.sustain}
                  onChange={(e) => setFilterEnvelope({ sustain: parseFloat(e.target.value) })}
                  disabled={!filterEnv.enabled}
                  className="w-full accent-lab-accent"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-lab-mute">Release</span>
                  <span className="font-mono text-lab-ink">{filterEnv.release.toFixed(3)}s</span>
                </div>
                <input
                  type="range"
                  min={0.005}
                  max={3}
                  step={0.001}
                  value={filterEnv.release}
                  onChange={(e) => setFilterEnvelope({ release: parseFloat(e.target.value) })}
                  disabled={!filterEnv.enabled}
                  className="w-full accent-lab-accent"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-lab-mute">深さ (depth)</span>
                <span className="font-mono text-lab-ink">
                  {filterEnv.depth >= 0 ? '+' : ''}{filterEnv.depth.toFixed(0)} Hz
                </span>
              </div>
              <input
                type="range"
                min={-8000}
                max={8000}
                step={50}
                value={filterEnv.depth}
                onChange={(e) => setFilterEnvelope({ depth: parseFloat(e.target.value) })}
                disabled={!filterEnv.enabled}
                className="w-full accent-lab-accent"
              />
              <div className="flex justify-between text-[10px] text-lab-mute">
                <span>-8kHz (閉じる)</span><span>0</span><span>+8kHz (開く)</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 行 2: LFO 1 / LFO 2 — 同じレイアウトを再利用、行き先は独立に選べる */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LfoPanel title="LFO 1" lfo={lfo} onChange={setLfo} />
        <LfoPanel title="LFO 2" lfo={lfo2} onChange={setLfo2} />
      </div>

      {/* ピッチベンド (リアルタイム演奏コントロール) */}
      <div className="rounded-lg border border-lab-line bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-lab-ink">ピッチベンド</span>
          <input
            type="range"
            min={-PITCH_BEND_RANGE}
            max={PITCH_BEND_RANGE}
            step={1}
            value={pitchBend}
            onChange={(e) => applyPitchBend(parseFloat(e.target.value))}
            onPointerUp={() => applyPitchBend(0)}
            className="flex-1 accent-lab-accent"
          />
          <span className="w-20 text-right font-mono text-sm">
            {pitchBend >= 0 ? '+' : ''}{pitchBend} ¢
          </span>
          <button
            onClick={() => applyPitchBend(0)}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-lab-mute hover:bg-slate-200"
          >
            0 に戻す
          </button>
        </div>
        <p className="mt-1 text-[11px] text-lab-mute">
          ±{PITCH_BEND_RANGE} cents（±{(PITCH_BEND_RANGE / 100).toFixed(0)} semitone）。スライダーを離すと自動で 0 へ戻ります。
        </p>
      </div>

        </div>
        {/* /左カラム */}

        {/* 右カラム: ライブ可視化（sticky） */}
        <div className="space-y-3 lg:sticky lg:top-2 lg:self-start">
          <Oscilloscope
            getAnalyser={AudioEngine.getAnalyserPost}
            getFrequency={getFrequency}
            title="演奏中の波形（オシロ）"
          />
          <FFTDisplay getAnalyser={AudioEngine.getAnalyserPost} title="FFTスペクトル（演奏中）" />
        </div>
      </div>
      {/* /2 カラムグリッド */}

      <Keyboard />
    </div>
  )
}
