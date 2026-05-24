import { useSynthStore } from '../store/synthStore'
import { midiToName } from '../lib/noteUtils'

/**
 * ホールド演奏中の状態をヘッダーに常時表示するバナー。
 * playSustain が null の間は何も描画しないので、各 step 画面のレイアウトには影響しない。
 *
 * 「停止」ボタンを押すと store.stopSustain がコールされ、
 *  - sequencer 駆動なら Sequencer.setRoot(null)
 *  - mono/poly 単純ホールドなら AudioEngine.noteOffAll()
 * と一緒に sustainOverride が解除されて、各 step の bypass 要求が再び有効になる。
 *
 * poly + hold の和音ホールドにも対応（midis を全て列挙表示）。
 */
export function PlayingBanner() {
  const playSustain = useSynthStore((s) => s.playSustain)
  const stopSustain = useSynthStore((s) => s.stopSustain)

  if (!playSustain) return null

  const { midis, withSequencer } = playSustain
  const noteList = midis.map(midiToName).join(' + ')
  const isChord = midis.length > 1

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs">
      <span className="font-semibold text-orange-700">
        🔊 ホールド演奏中{isChord && ` (${midis.length}音)`}
      </span>
      <span className="font-mono font-semibold text-lab-ink">{noteList}</span>
      {withSequencer ? (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          🎼 シーケンサー
        </span>
      ) : isChord ? (
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
          🎹 和音ホールド
        </span>
      ) : (
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
          🔒 単音ホールド
        </span>
      )}
      <span className="hidden text-[10px] text-lab-mute md:inline">
        ※ step を切り替えても演奏は継続します。同じ鍵をタップ／クリックで個別に停止できます。
      </span>
      <button
        onClick={stopSustain}
        className="ml-auto rounded-full bg-orange-500 px-3 py-0.5 text-[11px] font-semibold text-white shadow hover:bg-orange-600"
        title="ホールド演奏を全て停止"
      >
        ⏹ 全停止
      </button>
    </div>
  )
}
