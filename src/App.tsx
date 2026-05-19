import { useSynthStore } from './store/synthStore'
import { AudioEngine } from './audio/AudioEngine'
import { Stepper } from './components/Stepper'
import { Step1Waveform } from './pages/Step1Waveform'
import { Step2Envelope } from './pages/Step2Envelope'
import { Step3Filter } from './pages/Step3Filter'
import { Step4Play } from './pages/Step4Play'

export function App() {
  const step = useSynthStore((s) => s.step)
  const setStep = useSynthStore((s) => s.setStep)
  const audioReady = useSynthStore((s) => s.audioReady)
  const markAudioReady = useSynthStore((s) => s.markAudioReady)
  const patch = useSynthStore((s) => s.patch)

  const handleStart = async () => {
    try {
      await AudioEngine.start(patch)
      markAudioReady()
    } catch (e) {
      console.error('AudioEngine start failed', e)
      alert('音声の初期化に失敗しました。コンソールを確認してください。')
    }
  }

  if (!audioReady) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-lab-line bg-white p-8 shadow-lg text-center">
          <div className="text-3xl">🎛️</div>
          <h1 className="mt-3 text-2xl font-bold">音色学習シミュレータ</h1>
          <p className="mt-3 text-sm text-lab-mute">
            高校物理教材：波形・倍音・エンベロープ・フィルターを<br />
            視覚と聴覚で体験して、音色のしくみを学ぼう。
          </p>
          <button
            onClick={handleStart}
            className="mt-6 rounded-full bg-lab-accent px-6 py-3 text-base font-semibold text-white shadow hover:bg-sky-600"
          >
            ▶ クリックして開始
          </button>
          <p className="mt-3 text-xs text-lab-mute">※ ブラウザの仕様で、開始ボタンを押してから音が出せるようになります。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-lab-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-bold">🎛️ 音色学習シミュレータ</h1>
            <p className="text-xs text-lab-mute">高校物理 / 音のしくみを体験</p>
          </div>
          <Stepper current={step} onChange={setStep} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {step === 1 && <Step1Waveform />}
        {step === 2 && <Step2Envelope />}
        {step === 3 && <Step3Filter />}
        {step === 4 && <Step4Play />}
      </main>
      <footer className="mt-8 border-t border-lab-line bg-white py-4 text-center text-xs text-lab-mute">
        wavetable synthesis · AudioWorklet · React + TypeScript
      </footer>
    </div>
  )
}
