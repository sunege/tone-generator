import { useRef, useState } from 'react'
import { useSynthStore } from '../store/synthStore'
import { BANK_COUNT } from '../lib/banks'

const LONG_PRESS_MS = 700

type BankKind = 'tone' | 'seq'

type CellProps = {
  index: number
  occupied: boolean
  isActive: boolean
  label: string | null
  accent: 'sky' | 'emerald'
  onLoad: () => void
  onSave: () => void
}

/**
 * 1 つのバンクボタン。
 *   - 短押し（< 700ms）: ロード（中身があれば）
 *   - 長押し（>= 700ms）: 保存（押している間は緑のフィルが進捗を可視化）
 */
function BankCell({ index, occupied, isActive, label, accent, onLoad, onSave }: CellProps) {
  const [pressing, setPressing] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const timerRef = useRef<number | null>(null)
  const firedRef = useRef(false)

  const accentRing = isActive
    ? accent === 'sky'
      ? 'ring-2 ring-lab-accent'
      : 'ring-2 ring-emerald-500'
    : 'ring-1 ring-lab-line'

  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    firedRef.current = false
    setPressing(true)
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true
      onSave()
      setPressing(false)
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 350)
      timerRef.current = null
    }, LONG_PRESS_MS)
  }
  const end = () => {
    setPressing(false)
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      if (!firedRef.current && occupied) onLoad()
    }
  }
  const cancel = () => {
    setPressing(false)
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const title = occupied
    ? `${label ?? `バンク ${index + 1}`}（クリック=読込・長押し=上書き保存）`
    : '空のバンク（長押しで現在の設定を保存）'

  return (
    <button
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      title={title}
      className={`relative flex h-9 w-10 select-none items-center justify-center overflow-hidden rounded-md bg-white text-sm font-semibold text-lab-ink transition ${accentRing} ${
        justSaved ? 'bg-emerald-100' : ''
      }`}
    >
      {/* 長押し進捗フィル（origin-bottom で下から上へ伸びる） */}
      <span
        className={`pointer-events-none absolute inset-0 origin-bottom bg-emerald-300/70 transition-transform ease-linear ${
          pressing ? 'scale-y-100' : 'scale-y-0'
        }`}
        style={{ transitionDuration: pressing ? `${LONG_PRESS_MS}ms` : '120ms' }}
      />
      <span className="relative z-10 flex items-baseline gap-0.5">
        <span>{index + 1}</span>
        {occupied && <span className={`text-[10px] ${accent === 'sky' ? 'text-lab-accent' : 'text-emerald-600'}`}>●</span>}
      </span>
    </button>
  )
}

export function BankBar() {
  const banks = useSynthStore((s) => s.banks)
  const activeToneBank = useSynthStore((s) => s.activeToneBank)
  const activeSeqBank = useSynthStore((s) => s.activeSeqBank)
  const loadToneBank = useSynthStore((s) => s.loadToneBank)
  const saveToneBank = useSynthStore((s) => s.saveToneBank)
  const loadSeqBank = useSynthStore((s) => s.loadSeqBank)
  const saveSeqBank = useSynthStore((s) => s.saveSeqBank)
  const exportBanks = useSynthStore((s) => s.exportBanksAsJson)
  const importBanks = useSynthStore((s) => s.importBanksFromJson)
  const resetPatch = useSynthStore((s) => s.resetPatch)
  const resetBanksToDemo = useSynthStore((s) => s.resetBanksToDemo)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleReset = () => {
    if (confirm('全パラメータを初期値に戻しますか？\n（バンクの保存内容は維持されます）')) {
      resetPatch()
    }
  }

  const handleResetBanks = () => {
    if (confirm('全バンク（音色 5 + シーケンサー 5）を初期デモに戻しますか？\nユーザーが保存した内容はすべて失われます。')) {
      resetBanksToDemo()
    }
  }

  const handleExport = () => {
    const json = exportBanks()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `tone-banks-${ts}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      importBanks(text)
    } catch (e) {
      console.error('[BankBar] import failed', e)
      alert('バンクファイルの読み込みに失敗しました: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <BankGroup
          kind="tone"
          label="🎛️ 音色"
          keyHint="1〜5"
          accent="sky"
          banks={banks.tone}
          activeIndex={activeToneBank}
          onLoad={loadToneBank}
          onSave={saveToneBank}
        />
        <BankGroup
          kind="seq"
          label="🎼 シーケンサー"
          keyHint="Shift+1〜5"
          accent="emerald"
          banks={banks.seq}
          activeIndex={activeSeqBank}
          onLoad={loadSeqBank}
          onSave={saveSeqBank}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleReset}
            className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
            title="現在のパラメータをすべて初期値に戻す（バンクは保持）"
          >
            ⟲ デフォルト
          </button>
          <button
            onClick={handleResetBanks}
            className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
            title="全バンク（音色 5 + シーケンサー 5）を初期デモに戻す（保存済みのユーザー内容は失われる）"
          >
            🔄 デモ復元
          </button>
          <span className="h-5 w-px bg-lab-line" />
          <button
            onClick={handleExport}
            className="rounded-md border border-lab-line bg-white px-2 py-1 text-xs text-lab-ink hover:bg-slate-50"
            title="現在のバンク全体を JSON ファイルに書き出す"
          >
            📤 書き出し
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-lab-line bg-white px-2 py-1 text-xs text-lab-ink hover:bg-slate-50"
            title="JSON ファイルから全バンクを置き換える"
          >
            📥 読み込み
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <p className="text-[10px] leading-tight text-lab-mute">
        ※ バンクの保存先は<strong className="font-semibold">このブラウザ</strong>（localStorage）。
        リロードやタブを閉じても残りますが、別ブラウザ・別端末・シークレットウィンドウとは共有されません。
        持ち運びは <span className="font-mono">📤 書き出し</span> / <span className="font-mono">📥 読み込み</span> で JSON 経由。
      </p>
    </div>
  )
}

type GroupProps = {
  kind: BankKind
  label: string
  keyHint: string
  accent: 'sky' | 'emerald'
  banks: (({ label: string } | null))[]
  activeIndex: number | null
  onLoad: (i: number) => void
  onSave: (i: number) => void
}

function BankGroup({ kind: _kind, label, keyHint, accent, banks, activeIndex, onLoad, onSave }: GroupProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-semibold text-lab-mute">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: BANK_COUNT }, (_, i) => {
          const b = banks[i]
          return (
            <BankCell
              key={i}
              index={i}
              occupied={!!b}
              isActive={activeIndex === i}
              label={b?.label ?? null}
              accent={accent}
              onLoad={() => onLoad(i)}
              onSave={() => onSave(i)}
            />
          )
        })}
      </div>
      <span className="hidden text-[10px] text-lab-mute md:inline">[{keyHint}]</span>
    </div>
  )
}
