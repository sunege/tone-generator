import { useCallback, useEffect, useState } from 'react'
import { useSynthStore } from '../store/synthStore'
import { WaveformEditor } from '../components/WaveformEditor'
import { Oscilloscope } from '../components/Oscilloscope'
import { FFTDisplay } from '../components/FFTDisplay'
import { PresetSelector } from '../components/PresetSelector'
import { HintList } from '../components/Hint'
import { MicCapture } from '../components/MicCapture'
import { PRESETS } from '../lib/wavetablePresets'
import { AudioEngine } from '../audio/AudioEngine'

const TEST_FREQ = 440

export function Step1Waveform() {
  const patch = useSynthStore((s) => s.patch)
  const setWavetable = useSynthStore((s) => s.setWavetable)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  // プリセット選択マーカーは store 経由で永続化（ステップ切替で消えないように）
  const activePreset = useSynthStore((s) => s.activePresetKey)
  const setActivePreset = useSynthStore((s) => s.setActivePresetKey)
  const [playing, setPlaying] = useState(false)
  // ADSR/フィルター適用の ON/OFF。デフォルトは適用なし（素の波形）
  const [applyEffects, setApplyEffects] = useState(false)
  // マイクキャプチャから取得した1周期波形（オーバーレイ表示用）
  const [overlayWavetable, setOverlayWavetable] = useState<Float32Array | null>(null)

  const handleMicTransfer = useCallback(
    (wt: Float32Array) => {
      setActivePreset(undefined)
      setWavetable(wt)
    },
    [setWavetable],
  )

  const handleOverlay = useCallback((wt: Float32Array | null) => {
    setOverlayWavetable(wt)
  }, [])

  // Oscilloscope に渡すゲッターは再レンダで参照が変わらないよう useCallback で固定
  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  const handlePreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key)
    if (!preset) return
    setActivePreset(key)
    setWavetable(preset.generate())
  }

  const handleEdit = (w: Float32Array) => {
    setActivePreset(undefined)
    setWavetable(w)
  }

  // 波形編集中はデフォルトで envelope / filter を両方バイパスして「波形そのものの音」を聞く。
  // applyEffects が ON のときは Step2/3 の設定がそのまま掛かる。
  useEffect(() => {
    AudioEngine.setEnvelopeBypass(!applyEffects)
    AudioEngine.setFilterBypass(!applyEffects)
  }, [applyEffects])

  // 画面遷移時に連続再生を停止し、バイパス設定も解除
  useEffect(() => {
    return () => {
      AudioEngine.noteOff()
      AudioEngine.setEnvelopeBypass(false)
      AudioEngine.setFilterBypass(false)
      setCurrentFreq(null)
    }
  }, [setCurrentFreq])

  const togglePlay = () => {
    if (playing) {
      AudioEngine.noteOff()
      setCurrentFreq(null)
      setPlaying(false)
    } else {
      AudioEngine.noteOn(TEST_FREQ)
      setCurrentFreq(TEST_FREQ)
      setPlaying(true)
    }
  }

  const handleEffectsToggle = (next: boolean) => {
    setApplyEffects(next)
    // 連続再生中ならモードを反映するため一度ノートを取り直す
    if (playing) {
      AudioEngine.noteOff()
      // setRawMode の反映後に再アタックさせるため、わずかに遅らせる
      setTimeout(() => AudioEngine.noteOn(TEST_FREQ), 30)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 1 · 波形を作ろう</h2>
        <p className="mt-1 text-sm text-lab-mute">
          1周期分の波形を描いたり、数式で表したり、プリセットから選んだりしてみましょう。
        </p>
      </header>

      <HintList
        items={[
          'なめらかな波ほど柔らかい音になります',
          'ギザギザした波には高い周波数成分（倍音）が含まれます',
          '倍音が増えると音色が変わります',
        ]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={togglePlay}
          className={`inline-flex h-10 w-64 items-center justify-center rounded-full text-sm font-semibold text-white shadow transition ${
            playing ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'
          }`}
        >
          {playing ? '■ 停止' : '▶ 440Hz (A4) で連続再生'}
        </button>

        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-xs">
          <span className="px-2 text-lab-mute">エフェクト</span>
          <button
            onClick={() => handleEffectsToggle(false)}
            className={`rounded-full px-3 py-1 transition ${
              !applyEffects ? 'bg-white font-semibold text-lab-ink shadow' : 'text-lab-mute hover:text-lab-ink'
            }`}
          >
            OFF（素の音）
          </button>
          <button
            onClick={() => handleEffectsToggle(true)}
            className={`rounded-full px-3 py-1 transition ${
              applyEffects ? 'bg-white font-semibold text-lab-ink shadow' : 'text-lab-mute hover:text-lab-ink'
            }`}
          >
            ON（ADSR+フィルター）
          </button>
        </div>

        <span className="text-xs text-lab-mute">
          {applyEffects
            ? '※ Step2/3 で設定したエンベロープとフィルターが適用されます'
            : '※ 波形そのものの音（エンベロープ・フィルター適用なし）'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <WaveformEditor
            wavetable={patch.wavetable}
            onChange={handleEdit}
            overlayWavetable={overlayWavetable}
          />
          <PresetSelector
            title="波形プリセット"
            items={PRESETS.map((p) => ({ key: p.key, label: p.label, description: p.description }))}
            onPick={handlePreset}
            activeKey={activePreset}
          />
        </div>
        <div className="space-y-3">
          <Oscilloscope
            getAnalyser={AudioEngine.getAnalyserPost}
            getFrequency={getFrequency}
            title="再生中の波形（オシロ）"
          />
          <FFTDisplay getAnalyser={AudioEngine.getAnalyserPost} title="FFTスペクトル（リアルタイム）" />
        </div>
      </div>

      <MicCapture
        onTransfer={handleMicTransfer}
        onOverlay={handleOverlay}
        overlayActive={overlayWavetable !== null}
      />
    </div>
  )
}
