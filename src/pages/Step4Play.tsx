import { useCallback } from 'react'
import { useSynthStore } from '../store/synthStore'
import { Keyboard } from '../components/Keyboard'
import { Oscilloscope } from '../components/Oscilloscope'
import { FFTDisplay } from '../components/FFTDisplay'
import { HintList } from '../components/Hint'
import { AudioEngine } from '../audio/AudioEngine'

export function Step4Play() {
  const patch = useSynthStore((s) => s.patch)
  const getFrequency = useCallback(() => useSynthStore.getState().currentFreq, [])

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-bold">Step 4 · 演奏してみよう</h2>
        <p className="mt-1 text-sm text-lab-mute">
          作成した音色をピアノ鍵盤や PC キーボードで演奏できます。波形・FFT がリアルタイムで動きます。
        </p>
      </header>

      <HintList
        items={[
          '同じ音色でも音程（周波数）が変わると印象が変わります',
          'PCキーボード A 〜 ; は C4〜E5 の白鍵、W,E,T,Y,U,O,P は黒鍵に対応します',
          'オシロスコープは横軸が固定（A3の1周期分）。高い音ほど波が短く、たくさん収まる様子を観察してみましょう',
          '波形の振幅がエンベロープで変化する様子（Attack/Decay/Release）も見えます',
        ]}
      />

      <Keyboard />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-lab-line bg-white p-3 text-sm text-lab-mute">
          <div className="font-semibold text-lab-ink">音色サマリ</div>
          <ul className="mt-2 space-y-1">
            <li>Attack: <span className="font-mono">{patch.envelope.attack.toFixed(3)}s</span></li>
            <li>Decay: <span className="font-mono">{patch.envelope.decay.toFixed(3)}s</span></li>
            <li>Sustain: <span className="font-mono">{patch.envelope.sustain.toFixed(2)}</span></li>
            <li>Release: <span className="font-mono">{patch.envelope.release.toFixed(3)}s</span></li>
            <li>Cutoff: <span className="font-mono">{patch.filter.cutoff >= 1000 ? `${(patch.filter.cutoff / 1000).toFixed(2)} kHz` : `${patch.filter.cutoff.toFixed(0)} Hz`}</span></li>
          </ul>
        </div>
        <Oscilloscope
          getAnalyser={AudioEngine.getAnalyserPost}
          getFrequency={getFrequency}
        />
        <FFTDisplay getAnalyser={AudioEngine.getAnalyserPost} title="演奏中の FFT" />
      </div>
    </div>
  )
}
