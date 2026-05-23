import { useCallback, useEffect } from 'react'
import { useSynthStore } from '../store/synthStore'
import { Keyboard } from '../components/Keyboard'
import { Oscilloscope } from '../components/Oscilloscope'
import { FFTDisplay } from '../components/FFTDisplay'
import { HintList } from '../components/Hint'
import { AudioEngine } from '../audio/AudioEngine'
import type { FxId } from '../types'

// 各エフェクトのメタ情報（表示名・色・スライダ定義）
type ParamSpec = {
  name: string
  label: string
  min: number
  max: number
  step: number
  format?: (v: number) => string
}

type FxMeta = {
  id: FxId
  label: string
  hint: string
  accent: string  // tailwind 色プレフィックス
  params: ParamSpec[]
}

const FX_META: Record<FxId, FxMeta> = {
  distortion: {
    id: 'distortion',
    label: '🔥 ディストーション',
    hint: 'tanh カーブで波形をクリップ → 倍音を大量に追加（オーバードライブ系）',
    accent: 'bg-rose-50 border-rose-200',
    params: [
      { name: 'drive', label: 'Drive', min: 1, max: 100, step: 1, format: (v) => v.toFixed(0) },
      { name: 'tone', label: 'Tone', min: 200, max: 8000, step: 50, format: (v) => `${v.toFixed(0)} Hz` },
      { name: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
  bitcrusher: {
    id: 'bitcrusher',
    label: '🎮 ビットクラッシャー',
    hint: '量子化ビット数とサンプル保持回数を意図的に下げる → ローファイ／ファミコン風',
    accent: 'bg-amber-50 border-amber-200',
    params: [
      { name: 'bits', label: 'Bits', min: 1, max: 16, step: 1, format: (v) => `${v.toFixed(0)} bit` },
      { name: 'downsample', label: 'Sample Hold', min: 1, max: 32, step: 1, format: (v) => `${v.toFixed(0)}×` },
      { name: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
  chorus: {
    id: 'chorus',
    label: '🌊 コーラス',
    hint: '短いディレイ＋LFO で揺らぐコピーを混ぜる → 厚みと広がり',
    accent: 'bg-sky-50 border-sky-200',
    params: [
      { name: 'rate', label: 'Rate', min: 0.1, max: 5, step: 0.05, format: (v) => `${v.toFixed(2)} Hz` },
      { name: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
      { name: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
  phaser: {
    id: 'phaser',
    label: '🌀 フェイザー',
    hint: '4 段の allpass フィルターを LFO で揺らす → "シュワシュワ" した周期的スイープ',
    accent: 'bg-violet-50 border-violet-200',
    params: [
      { name: 'rate', label: 'Rate', min: 0.05, max: 5, step: 0.01, format: (v) => `${v.toFixed(2)} Hz` },
      { name: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
      { name: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, format: (v) => v.toFixed(2) },
      { name: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
  delay: {
    id: 'delay',
    label: '⏱️ ディレイ',
    hint: 'feedback を上げるほど反復回数が増える。time を短くするとコムフィルター効果',
    accent: 'bg-emerald-50 border-emerald-200',
    params: [
      { name: 'time', label: 'Time', min: 0.01, max: 1.0, step: 0.005, format: (v) => `${(v * 1000).toFixed(0)} ms` },
      { name: 'feedback', label: 'Feedback', min: 0, max: 0.95, step: 0.01, format: (v) => v.toFixed(2) },
      { name: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
  reverb: {
    id: 'reverb',
    label: '🏛️ リバーブ',
    hint: '合成インパルス応答（ノイズ × 指数減衰）の畳み込み。decay で空間の大きさを表現',
    accent: 'bg-indigo-50 border-indigo-200',
    params: [
      { name: 'decay', label: 'Decay', min: 0.3, max: 5, step: 0.05, format: (v) => `${v.toFixed(2)} s` },
      { name: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
    ],
  },
}

export function Step6Effects() {
  const fxState = useSynthStore((s) => s.patch.fx)
  const setFxEnabled = useSynthStore((s) => s.setFxEnabled)
  const setFxParam = useSynthStore((s) => s.setFxParam)
  const moveFx = useSynthStore((s) => s.moveFx)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)

  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  // 入室時に FX チェーンをアクティブ化、退室時にバイパス
  useEffect(() => {
    AudioEngine.setEnvelopeBypass(false)
    AudioEngine.setFilterBypass(false)
    AudioEngine.setLfoBypass(false)
    AudioEngine.setFxChainBypass(false)
    return () => {
      AudioEngine.noteOff()
      AudioEngine.setEnvelopeBypass(false)
      AudioEngine.setFilterBypass(false)
      AudioEngine.setLfoBypass(true)
      AudioEngine.setFxChainBypass(true)  // 他ステップに FX が漏れないようバイパス
      setCurrentFreq(null)
    }
  }, [setCurrentFreq])

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 6 · エフェクター</h2>
        <p className="mt-1 text-sm text-lab-mute">
          シンセの音に空間系・モジュレーション系・歪み系のエフェクトを直列にかけて音を加工します。
          上の方が先に通る順番で、↑↓で並び替えできます。
        </p>
      </header>

      <HintList
        items={[
          '同じ音色でもエフェクトの順番で印象が変わります（例: 歪み→ディレイ vs ディレイ→歪み）',
          'リバーブやディレイは時間系。チェーンの最後に置くと自然に聞こえます',
          'ビットクラッシャーは "サンプリングレート" と "量子化ビット" を体感的に学べます',
          'フェイザーは allpass フィルターという位相だけ変えるフィルターを使っています',
        ]}
      />

      {/*
        2-column layout (lg 以上):
          - 左 (2fr): FX チェーン縦並び。スクロールしながら任意のエフェクトを編集
          - 右 (1fr): Oscilloscope / FFT を縦スタックで sticky
        lg 未満 (タブレット・モバイル) では 1 列に縦積みで従来通り。
        self-start を付けて sticky が grid のコンテナ高さに引っ張られないようにする。
      */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* 左: FX チェーン */}
        <div className="space-y-3">
          {fxState.order.map((id, idx) => {
            const meta = FX_META[id]
            const st = fxState.fx[id]
            const isFirst = idx === 0
            const isLast = idx === fxState.order.length - 1
            return (
              <div
                key={id}
                className={`rounded-lg border p-3 transition ${meta.accent} ${
                  st.enabled ? '' : 'opacity-60'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-lab-ink">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-lab-ink">{meta.label}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => moveFx(id, 'up')}
                      disabled={isFirst}
                      title="チェーン内で1つ前に移動"
                      className="rounded bg-white px-2 py-1 text-xs text-lab-mute hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveFx(id, 'down')}
                      disabled={isLast}
                      title="チェーン内で1つ後ろに移動"
                      className="rounded bg-white px-2 py-1 text-xs text-lab-mute hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <label className="ml-2 flex cursor-pointer items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={st.enabled}
                        onChange={(e) => setFxEnabled(id, e.target.checked)}
                        className="accent-lab-accent"
                      />
                      <span className={st.enabled ? 'font-semibold text-lab-ink' : 'text-lab-mute'}>
                        {st.enabled ? 'ON' : 'OFF'}
                      </span>
                    </label>
                  </div>
                </div>

                <p className="mt-1 text-[11px] text-lab-mute">{meta.hint}</p>

                {/* 右サイド固定で横幅が狭くなったので、スライダーは sm/lg ともに 2 列に揃える */}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {meta.params.map((p) => {
                    const value = st.params[p.name] ?? 0
                    return (
                      <div key={p.name} className="space-y-0.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-lab-mute">{p.label}</span>
                          <span className="font-mono text-lab-ink">{p.format ? p.format(value) : value.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          value={value}
                          onChange={(e) => setFxParam(id, p.name, parseFloat(e.target.value))}
                          disabled={!st.enabled}
                          className="w-full accent-lab-accent"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* 右: ライブ可視化（sticky）。top-2 はヘッダーがスクロールアウトした後に画面上部に張り付く位置 */}
        <div className="space-y-3 lg:sticky lg:top-2 lg:self-start">
          <Oscilloscope
            getAnalyser={AudioEngine.getAnalyserOut}
            getFrequency={getFrequency}
            title="演奏中の波形 (FX 後)"
          />
          <FFTDisplay getAnalyser={AudioEngine.getAnalyserOut} title="FFT スペクトル (FX 後)" />
        </div>
      </div>

      <Keyboard />
    </div>
  )
}
