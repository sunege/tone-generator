import { useCallback, useEffect, useState } from 'react'
import { useSynthStore } from '../store/synthStore'
import { EnvelopeEditor } from '../components/EnvelopeEditor'
import { PresetSelector } from '../components/PresetSelector'
import { HintList } from '../components/Hint'
import { Oscilloscope } from '../components/Oscilloscope'
import { FFTDisplay } from '../components/FFTDisplay'
import { ENV_PRESETS } from '../lib/envelopePresets'
import { AudioEngine } from '../audio/AudioEngine'

const TEST_FREQ = 440

export function Step2Envelope() {
  const patch = useSynthStore((s) => s.patch)
  const setEnvelope = useSynthStore((s) => s.setEnvelope)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  // エンベロープ プリセット選択マーカーは store 経由で永続化（ステップ切替で消えないように）
  const activePreset = useSynthStore((s) => s.activeEnvelopePresetKey)
  const setActivePreset = useSynthStore((s) => s.setActiveEnvelopePresetKey)
  const [holding, setHolding] = useState(false)
  // フィルター適用の ON/OFF。デフォルトは適用なし（フィルターはバイパスして純粋に ADSR の効果だけを聞く）
  const [applyFilter, setApplyFilter] = useState(false)

  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  const handlePreset = (key: string) => {
    const p = ENV_PRESETS.find((x) => x.key === key)
    if (!p) return
    setActivePreset(key)
    setEnvelope(p.envelope)
  }

  const startNote = () => {
    AudioEngine.noteOn(TEST_FREQ)
    setCurrentFreq(TEST_FREQ)
    setHolding(true)
  }

  const stopNote = () => {
    AudioEngine.noteOff()
    // currentFreq は意図的に残す: Release 中の波形をオシロで観察できるようにするため。
    // 実際の音が消えればオシロ側の silence 閾値で自動的にフラット表示になる。
    setHolding(false)
  }

  // フィルターのバイパスを applyFilter に同期
  useEffect(() => {
    AudioEngine.setFilterBypass(!applyFilter)
  }, [applyFilter])

  // 画面遷移時に発音とフィルターバイパスを解除
  useEffect(() => {
    return () => {
      AudioEngine.noteOff()
      AudioEngine.setFilterBypass(false)
      setCurrentFreq(null)
    }
  }, [setCurrentFreq])

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 2 · 音の変化を作ろう</h2>
        <p className="mt-1 text-sm text-lab-mute">
          音の「立ち上がり」「減衰」「持続」「余韻」を ADSR で調整します。
        </p>
      </header>

      <HintList
        items={[
          'Attack が短いと打楽器のような立ち上がりになります',
          'Release を長くすると余韻（残響感）が残ります',
          'Sustain を 0 にすると、押している間も音が消えます（打楽器的）',
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            ;(e.target as Element).setPointerCapture(e.pointerId)
            startNote()
          }}
          onPointerUp={stopNote}
          onPointerCancel={stopNote}
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault()
              startNote()
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              stopNote()
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={`inline-flex h-10 w-64 select-none items-center justify-center rounded-full text-sm font-semibold text-white shadow transition ${
            holding ? 'bg-rose-500' : 'bg-emerald-500 hover:bg-emerald-600'
          }`}
          style={{ touchAction: 'none' }}
        >
          {holding ? '🔊 発音中… 離すと停止' : '▶ 押している間 440Hz を発音'}
        </button>

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

        <span className="text-xs text-lab-mute">
          {applyFilter
            ? '※ Step3 で設定したフィルターも適用された音'
            : '※ フィルター無効。純粋に ADSR の効果だけを聞けます'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <EnvelopeEditor envelope={patch.envelope} onChange={setEnvelope} />
          <PresetSelector
            title="エンベロープ プリセット"
            items={ENV_PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description }))}
            onPick={handlePreset}
            activeKey={activePreset}
          />
        </div>
        <div className="space-y-3">
          <Oscilloscope
            getAnalyser={AudioEngine.getAnalyserPost}
            getFrequency={getFrequency}
            title="発音中の波形（オシロ）"
          />
          <FFTDisplay getAnalyser={AudioEngine.getAnalyserPost} title="FFTスペクトル（発音中）" />
        </div>
      </div>
    </div>
  )
}
