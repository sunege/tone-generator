import { useCallback, useEffect, useState } from 'react'
import { useSynthStore } from '../store/synthStore'
import { Keyboard } from '../components/Keyboard'
import { Oscilloscope } from '../components/Oscilloscope'
import { FFTDisplay } from '../components/FFTDisplay'
import { HintList } from '../components/Hint'
import { AudioEngine } from '../audio/AudioEngine'
import { Sequencer } from '../audio/sequencer'
import { SEQUENCER_MAX_STEPS } from '../types'

/**
 * Step 7: パターン編集とライブ演奏。
 * ホールド／シーケンサー ON/OFF は鍵盤ヘッダー側に統合済み（全 step 共通）。
 * このページは「pattern を編集する場」+「sequencer ON で押下デモ」を提供する。
 */

// 半音オフセット → 度数名（オクターブ越えは ↑/↓ で表現）
//
// 音の「ピッチクラス」を root の度数名で表す。マイナス側は lower octave の度数になる。
// 例:
//   -1 → M7↓ (root の 1 半音下 = octave 下の M7)
//   -3 → M6↓
//   -5 → P5↓ (= 完全 4 度下と同じ音)
//   -12 → P1↓
//   -13 → M7↓↓
const INTERVAL_NAMES = ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7']

function intervalName(semitones: number): string {
  // Math.floor は負の数で -∞ 方向に丸めるので octave 計算が自然に成立する
  const pitchClass = ((semitones % 12) + 12) % 12
  const octaves = Math.floor(semitones / 12)
  const base = INTERVAL_NAMES[pitchClass]
  if (octaves === 0) return base
  if (octaves > 0) return base + '↑'.repeat(Math.min(3, octaves))
  return base + '↓'.repeat(Math.min(3, -octaves))
}

const DIVISIONS: { value: number; label: string }[] = [
  { value: 4, label: '1/4' },
  { value: 8, label: '1/8' },
  { value: 16, label: '1/16' },
  { value: 32, label: '1/32' },
]

export function Step7Sequencer() {
  const seq = useSynthStore((s) => s.patch.sequencer)
  const setSequencerConfig = useSynthStore((s) => s.setSequencerConfig)
  const setSeqStep = useSynthStore((s) => s.setSeqStep)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)

  // 再生中のハイライト用（-1 は停止中）
  const [currentStep, setCurrentStep] = useState<number>(-1)

  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  // ステップ変更時に Sequencer の設定を最新化（store 経由でも入るが念のため）
  useEffect(() => {
    Sequencer.setConfig(seq)
  }, [seq])

  // 入退室時のバイパス制御 + Sequencer コールバック接続。
  // ホールド演奏中（playSustain != null）は noteOff / setCurrentFreq(null) をスキップして
  // step 跨ぎの継続再生を維持する（bypass 書き戻しは sustainOverride が吸収するため触らない）。
  useEffect(() => {
    AudioEngine.setEnvelopeBypass(false)
    AudioEngine.setFilterBypass(false)
    AudioEngine.setLfoBypass(false)
    AudioEngine.setFxChainBypass(false)

    Sequencer.onStepChange = (step) => setCurrentStep(step)
    Sequencer.onNote = (freq) => setCurrentFreq(freq)

    return () => {
      Sequencer.onStepChange = null
      Sequencer.onNote = null
      const sustaining = useSynthStore.getState().playSustain !== null
      if (!sustaining) {
        Sequencer.forceStop()
        AudioEngine.noteOff()
        setCurrentFreq(null)
      }
      AudioEngine.setEnvelopeBypass(false)
      AudioEngine.setFilterBypass(false)
      AudioEngine.setLfoBypass(true)
      AudioEngine.setFxChainBypass(true)
    }
  }, [setCurrentFreq])

  const changeStepSemitones = (i: number, delta: number) => {
    const cur = seq.steps[i]
    const next = Math.max(-24, Math.min(24, cur.semitones + delta))
    setSeqStep(i, { semitones: next })
  }

  const toggleStep = (i: number) => {
    setSeqStep(i, { enabled: !seq.steps[i].enabled })
  }

  // 表示するのは length 個まで。後ろは「再生対象外」として薄く表示。
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 7 · ステップシーケンサー（アルペジエイター）</h2>
        <p className="mt-1 text-sm text-lab-mute">
          鍵盤を押している間、設定したパターンに沿って自動演奏します。押した音が root（度数 1）になります。
        </p>
      </header>

      <HintList
        items={[
          'BPM・音価・長さ・ゲートでリズムを自由に組み立てられます',
          '各ステップの数値は root からの半音オフセット（+12 = 1 オクターブ上、-12 = 1 オクターブ下）',
          '隣の度数表記（P5・M3 など）はそのピッチクラスの度数名。マイナス側は lower octave の度数 + ↓ で示します（例: -1 = M7↓）',
          '鍵盤を押し変えると next-press 優先で root が変わり、シーケンスは継続します',
        ]}
      />

      {/* 上部: パターン設定スライダー */}
      <div className="grid gap-3 rounded-lg border border-lab-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-lab-mute">BPM</span>
            <span className="font-mono text-lab-ink">{seq.bpm}</span>
          </div>
          <input
            type="range" min={40} max={240} step={1}
            value={seq.bpm}
            onChange={(e) => setSequencerConfig({ bpm: parseInt(e.target.value, 10) })}
            className="w-full accent-lab-accent"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-lab-mute">1 ステップの音価</div>
          <div className="flex gap-1">
            {DIVISIONS.map((d) => {
              const active = seq.division === d.value
              return (
                <button
                  key={d.value}
                  onClick={() => setSequencerConfig({ division: d.value })}
                  className={`flex-1 rounded-full px-2 py-1 text-xs transition ${
                    active ? 'bg-lab-accent font-semibold text-white' : 'bg-slate-100 text-lab-mute hover:bg-slate-200'
                  }`}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-lab-mute">再生ステップ数</span>
            <span className="font-mono text-lab-ink">{seq.length}</span>
          </div>
          <input
            type="range" min={1} max={SEQUENCER_MAX_STEPS} step={1}
            value={seq.length}
            onChange={(e) => setSequencerConfig({ length: parseInt(e.target.value, 10) })}
            className="w-full accent-lab-accent"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-lab-mute">ゲート</span>
            <span className="font-mono text-lab-ink">{(seq.gate * 100).toFixed(0)} %</span>
          </div>
          <input
            type="range" min={0.05} max={1} step={0.01}
            value={seq.gate}
            onChange={(e) => setSequencerConfig({ gate: parseFloat(e.target.value) })}
            className="w-full accent-lab-accent"
          />
          <p className="text-[10px] text-lab-mute">小: スタッカート / 大: レガート</p>
        </div>
      </div>

      {/* ステップグリッド（8 列 × 4 行 = 32 セル） */}
      <div className="space-y-2 rounded-lg border border-lab-line bg-white p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-lab-ink">パターン ({seq.length} / {SEQUENCER_MAX_STEPS} ステップ)</div>
          <div className="text-[11px] text-lab-mute">
            現在: <span className="font-mono">{currentStep < 0 ? '停止中' : `STEP ${(currentStep + 1).toString().padStart(2, '0')}`}</span>
          </div>
        </div>

        <div className="grid grid-cols-8 gap-1">
          {seq.steps.map((step, i) => {
            const inLength = i < seq.length
            const isCurrent = i === currentStep
            // 4 ステップごとに薄い区切り色を入れる（拍頭わかりやすく）
            const beatBoundary = i % 4 === 0
            return (
              <div
                key={i}
                className={[
                  'flex flex-col items-stretch rounded border p-1 text-center transition',
                  inLength ? 'bg-white' : 'bg-slate-50 opacity-50',
                  step.enabled && inLength
                    ? 'border-lab-accent'
                    : 'border-slate-200',
                  isCurrent ? 'ring-2 ring-emerald-400 shadow' : '',
                  beatBoundary ? 'border-l-2 border-l-slate-400' : '',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-lab-mute">
                    {(i + 1).toString().padStart(2, '0')}
                  </span>
                  <button
                    onClick={() => toggleStep(i)}
                    title={step.enabled ? 'ON (クリックで OFF)' : 'OFF (クリックで ON)'}
                    className={`h-3 w-3 rounded-full transition ${
                      step.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                </div>
                <div className="mt-0.5 leading-tight">
                  <div className="font-mono text-base font-bold text-lab-ink">
                    {step.semitones >= 0 ? '+' : ''}{step.semitones}
                  </div>
                  <div className="text-[10px] text-lab-mute">{intervalName(step.semitones)}</div>
                </div>
                <div className="mt-0.5 flex justify-center gap-1">
                  <button
                    onClick={() => changeStepSemitones(i, -1)}
                    className="flex-1 rounded bg-slate-100 text-[10px] text-lab-mute hover:bg-slate-200"
                    title="半音下げる"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => changeStepSemitones(i, +1)}
                    className="flex-1 rounded bg-slate-100 text-[10px] text-lab-mute hover:bg-slate-200"
                    title="半音上げる"
                  >
                    ▲
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="text-[11px] text-lab-mute">
          ●：ON / ○：OFF（クリックで切替）・▲▼：半音単位で変更・濃い縦線：4 ステップごとの拍頭
        </div>
      </div>

      {/* 鍵盤。ホールド／シーケンサー トグルは Keyboard 自身のヘッダーに統合済み。 */}
      <div>
        <p className="mb-2 text-xs text-lab-mute">
          鍵盤の <strong>🎼 シーケンサー</strong> を ON にすると、押した音が root（度数 1）になりこのパターンが演奏されます。
          <strong>🔒 ホールド</strong> を併用すると、同じ鍵を再度押すまで鳴り続け、step を切り替えても演奏が継続します。
        </p>
        <Keyboard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Oscilloscope
          getAnalyser={AudioEngine.getAnalyserOut}
          getFrequency={getFrequency}
          title="演奏中の波形 (FX 後)"
        />
        <FFTDisplay getAnalyser={AudioEngine.getAnalyserOut} title="FFT スペクトル (FX 後)" />
      </div>
    </div>
  )
}
