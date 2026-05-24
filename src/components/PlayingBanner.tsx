import { useSynthStore } from '../store/synthStore'
import { midiToName, midiToFreq } from '../lib/noteUtils'

/**
 * ホールド演奏中の状態をヘッダーに常時表示するバナー。
 * playSustain が null の間は何も描画しないので、各 step 画面のレイアウトには影響しない。
 *
 * 「停止」ボタンを押すと store.stopSustain がコールされ、
 *  - sequencer 駆動なら Sequencer.setRoot(null)
 *  - 単音なら AudioEngine.noteOff()
 * と一緒に sustainOverride が解除されて、各 step の bypass 要求が再び有効になる。
 */
export function PlayingBanner() {
  const playSustain = useSynthStore((s) => s.playSustain)
  const stopSustain = useSynthStore((s) => s.stopSustain)

  if (!playSustain) return null

  const { midi, withSequencer } = playSustain

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs">
      <span className="font-semibold text-orange-700">🔊 ホールド演奏中</span>
      <span className="font-mono font-semibold text-lab-ink">{midiToName(midi)}</span>
      <span className="font-mono text-orange-700">{midiToFreq(midi).toFixed(1)} Hz</span>
      {withSequencer ? (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          🎼 シーケンサー
        </span>
      ) : (
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
          🔒 単音ホールド
        </span>
      )}
      <span className="hidden text-[10px] text-lab-mute md:inline">
        ※ step を切り替えても演奏は継続します。同じ鍵をタップ／クリックでも停止できます。
      </span>
      <button
        onClick={stopSustain}
        className="ml-auto rounded-full bg-orange-500 px-3 py-0.5 text-[11px] font-semibold text-white shadow hover:bg-orange-600"
        title="ホールド演奏を停止"
      >
        ⏹ 停止
      </button>
    </div>
  )
}
