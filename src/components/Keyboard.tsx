import { useEffect, useMemo, useRef, useState } from 'react'
import { isBlackKey, midiToFreq, midiToName, midiToSolfege, KEY_TO_MIDI_OFFSET } from '../lib/noteUtils'
import { AudioEngine } from '../audio/AudioEngine'
import { Sequencer } from '../audio/sequencer'
import { useSynthStore } from '../store/synthStore'

type Props = {
  startMidi?: number    // 一番左の白鍵 (デフォルト C3=48)
  octaves?: number      // オクターブ数
}

/**
 * 鍵盤。すべての挙動を store 駆動で行うため、外部からはプロップ不要。
 *
 * モード（store: keyboardHold / sequencerEnabled / polyMode）:
 *  - 🔒 ホールド: 同じ鍵を再押下するまで音が止まらない。step を跨いでも継続。
 *  - 🎼 シーケンサー: 押下した鍵をルートとしてシーケンサーが演奏。
 *  - 🎹 ポリ: 複数鍵を同時発音（最大 8 voice）。ホールド／シーケンサーとは相互排他。
 *
 * ホールド演奏中（playSustain != null）は AudioEngine.setSustainOverride(true) によって
 * envelope/filter/lfo/fxChain の bypass 要求がすべて無視され、フルチェーン再生になる。
 *
 * ポリ時はマルチタッチに対応（dragPointersRef で pointerId ごとに別の midi を追跡）。
 */
export function Keyboard({ startMidi = 48, octaves = 3 }: Props) {
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  const keyboardHold = useSynthStore((s) => s.keyboardHold)
  const sequencerEnabled = useSynthStore((s) => s.sequencerEnabled)
  const polyMode = useSynthStore((s) => s.polyMode)
  const playSustain = useSynthStore((s) => s.playSustain)
  const setKeyboardHold = useSynthStore((s) => s.setKeyboardHold)
  const setSequencerEnabled = useSynthStore((s) => s.setSequencerEnabled)
  const setPolyMode = useSynthStore((s) => s.setPolyMode)
  const startSustain = useSynthStore((s) => s.startSustain)
  const pcBaseMidi = 60 // PCキーボードの "a" を C4 に割当

  // SVG への native touchstart リスナを attach するための ref。
  const svgRef = useRef<SVGSVGElement>(null)

  // PC キーボードハンドラ等は useEffect([]) で 1 回だけ登録される。
  // store の最新値を参照したいので ref に常時同期。
  const holdRef = useRef(keyboardHold)
  const seqRef = useRef(sequencerEnabled)
  const polyRef = useRef(polyMode)
  useEffect(() => { holdRef.current = keyboardHold }, [keyboardHold])
  useEffect(() => { seqRef.current = sequencerEnabled }, [sequencerEnabled])
  useEffect(() => { polyRef.current = polyMode }, [polyMode])

  // 鍵盤に含まれる MIDI 番号
  const keys = useMemo(() => {
    const arr: number[] = []
    const totalKeys = 12 * octaves + 1 // 末尾の C を含める
    for (let i = 0; i < totalKeys; i++) arr.push(startMidi + i)
    return arr
  }, [startMidi, octaves])

  const whiteKeys = keys.filter((m) => !isBlackKey(m))

  // 「最後に押された鍵優先」のモノフォニック挙動のため、押下中の鍵を順序保持する（mono 用）。
  const heldRef = useRef<number[]>([])
  // pointer (タッチ／マウス) ごとに「現在指の下にある鍵」を追跡。
  // mono モードでは要素数を 1 つに制限する。poly モードでは最大 8 同時タッチ可。
  const dragPointersRef = useRef<Map<number, number>>(new Map())
  // 表示用の active midi 集合（mono は 0/1 個、poly は最大 8 個）
  const [activeMidis, setActiveMidis] = useState<Set<number>>(new Set())
  const activeMidisRef = useRef<Set<number>>(new Set())

  const setActiveAdd = (midi: number) => {
    activeMidisRef.current.add(midi)
    setActiveMidis(new Set(activeMidisRef.current))
  }
  const setActiveRemove = (midi: number) => {
    activeMidisRef.current.delete(midi)
    setActiveMidis(new Set(activeMidisRef.current))
  }
  const setActiveReplace = (midi: number | null) => {
    activeMidisRef.current = new Set(midi !== null ? [midi] : [])
    setActiveMidis(new Set(activeMidisRef.current))
  }
  const setActiveClear = () => {
    activeMidisRef.current = new Set()
    setActiveMidis(new Set())
  }

  const press = (midi: number) => {
    // ホールドモード: store 経由で sustain を起動・切替・停止（同 midi なら停止）
    if (holdRef.current) {
      startSustain(midi)
      return
    }

    // ポリモード: voice key 付き noteOn。activeMidis に追加。
    if (polyRef.current) {
      const freq = midiToFreq(midi)
      AudioEngine.noteOn(freq, midi)
      setActiveAdd(midi)
      setCurrentFreq(freq)  // オシロは最後に鳴った音にロック（最も自然）
      return
    }

    // モノモード: モノフォニック last-press 優先
    const idx = heldRef.current.indexOf(midi)
    if (idx >= 0) heldRef.current.splice(idx, 1)
    heldRef.current.push(midi)

    const freq = midiToFreq(midi)
    if (seqRef.current) {
      Sequencer.setRoot(midi)
    } else {
      AudioEngine.noteOn(freq)
    }
    setActiveReplace(midi)
    setCurrentFreq(freq)
  }

  const release = (midi: number) => {
    // ホールドモードではキーリリースは何もしない（root は次の press まで継続）
    if (holdRef.current) return

    // ポリモード: 該当 voice だけ release。残り voice があれば currentFreq は維持。
    if (polyRef.current) {
      AudioEngine.noteOff(midi)
      setActiveRemove(midi)
      if (activeMidisRef.current.size === 0) setCurrentFreq(null)
      return
    }

    // モノモード: last-press 優先での legato
    const idx = heldRef.current.indexOf(midi)
    if (idx >= 0) heldRef.current.splice(idx, 1)

    if (heldRef.current.length === 0) {
      if (seqRef.current) {
        Sequencer.setRoot(null)
      } else {
        AudioEngine.noteOff()
      }
      setActiveReplace(null)
      setCurrentFreq(null)
      return
    }
    // 残っている最新の鍵に音程だけ切り替え（エンベロープは再アタックしない＝レガート）
    const nextMidi = heldRef.current[heldRef.current.length - 1]
    const nextFreq = midiToFreq(nextMidi)
    if (seqRef.current) {
      Sequencer.setRoot(nextMidi)
    } else {
      AudioEngine.setFrequency(nextFreq)
    }
    setActiveReplace(nextMidi)
    setCurrentFreq(nextFreq)
  }

  const releaseAll = () => {
    heldRef.current = []
    dragPointersRef.current.clear()
    if (holdRef.current) return  // ホールド中の演奏は維持する
    if (polyRef.current) {
      AudioEngine.noteOffAll()
    } else if (seqRef.current) {
      Sequencer.setRoot(null)
    } else {
      AudioEngine.noteOff()
    }
    setActiveClear()
    setCurrentFreq(null)
  }

  // SVG レベルの pointermove。data-midi 属性つきの rect の上に指がきたら遷移する（グライド）。
  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const cur = dragPointersRef.current.get(e.pointerId)
    if (cur === undefined) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!(el instanceof Element)) return
    const attr = el.getAttribute('data-midi')
    if (!attr) return
    const newMidi = parseInt(attr, 10)
    if (Number.isNaN(newMidi) || newMidi === cur) return

    if (polyRef.current) {
      // ポリ: 古い midi を release してから新しい midi を press
      release(cur)
      dragPointersRef.current.set(e.pointerId, newMidi)
      press(newMidi)
    } else {
      // モノ: heldRef 経由でレガート切替（press の last-priority ロジックに任せる）
      const idx = heldRef.current.indexOf(cur)
      if (idx >= 0) heldRef.current.splice(idx, 1)
      dragPointersRef.current.set(e.pointerId, newMidi)
      press(newMidi)
    }
  }

  // pointerup / pointerleave / pointercancel いずれもドラッグ終了として扱う。
  const handleSvgPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    const midi = dragPointersRef.current.get(e.pointerId)
    if (midi === undefined) return
    dragPointersRef.current.delete(e.pointerId)
    release(midi)
  }

  // 個別の鍵 rect から呼ばれる押下処理（ドラッグの起点登録）。
  // モノ時は 2 本目以降の指を無視。ポリ時は最大 POLY_VOICES 本まで同時発音可。
  const handleKeyPointerDown = (e: React.PointerEvent<SVGElement>, midi: number) => {
    e.preventDefault()
    if (!polyRef.current && dragPointersRef.current.size > 0) return  // mono: 1 本だけ
    dragPointersRef.current.set(e.pointerId, midi)
    press(midi)
  }

  // iOS Safari の SVG タッチイベント不発バグ対策。
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
    }
    svg.addEventListener('touchstart', onTouchStart, { passive: false })
    return () => svg.removeEventListener('touchstart', onTouchStart)
  }, [])

  // モード切替時のクリーンアップ。
  // hold / sequencer / poly のいずれかが「実際に」変わったら、通常モードで押下中だった音を止める。
  //
  // 注: 単純な isInitialMount 方式は React 18 の StrictMode dev で破綻する。
  // StrictMode は useEffect を mount 直後に意図的に 2 回実行するため、初回 return 後に
  // 2 回目が走ってしまい noteOffAll() が他 step のホールド sustain を殺してしまう。
  // そのため「前回値」を ref に持って、実際にトグル値が変わった時だけ発火する形に変える。
  const prevTogglesRef = useRef<{ hold: boolean; seq: boolean; poly: boolean } | null>(null)
  useEffect(() => {
    const prev = prevTogglesRef.current
    const cur = { hold: keyboardHold, seq: sequencerEnabled, poly: polyMode }
    prevTogglesRef.current = cur
    if (!prev) return  // 初回（or StrictMode の 1 回目）
    if (prev.hold === cur.hold && prev.seq === cur.seq && prev.poly === cur.poly) return  // StrictMode 2 回目
    // 実際にトグルが変わった: ローカル状態を掃除して通常モードの押下中音を止める
    heldRef.current = []
    activeMidisRef.current = new Set()
    setActiveMidis(new Set())
    AudioEngine.noteOff()
    AudioEngine.noteOffAll()
    Sequencer.setRoot(null)
    setCurrentFreq(null)
  }, [keyboardHold, sequencerEnabled, polyMode, setCurrentFreq])

  // PC キーボード
  useEffect(() => {
    const downHandler = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return
      }
      const key = e.key.toLowerCase()
      const offset = KEY_TO_MIDI_OFFSET[key]
      if (offset === undefined) return
      e.preventDefault()
      press(pcBaseMidi + offset)
    }
    const upHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const offset = KEY_TO_MIDI_OFFSET[key]
      if (offset === undefined) return
      release(pcBaseMidi + offset)
    }
    // ウィンドウがフォーカスを失ったときは押下中の鍵を全て解放する（keyup を取りこぼすため）
    // ホールド中の音は releaseAll 内で残す
    const blurHandler = () => releaseAll()
    window.addEventListener('keydown', downHandler)
    window.addEventListener('keyup', upHandler)
    window.addEventListener('blur', blurHandler)
    return () => {
      window.removeEventListener('keydown', downHandler)
      window.removeEventListener('keyup', upHandler)
      window.removeEventListener('blur', blurHandler)
      releaseAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SVG レイアウト
  const whiteWidth = 50
  const whiteHeight = 180
  const blackWidth = 30
  const blackHeight = 110
  const totalWidth = whiteKeys.length * whiteWidth

  // 各白鍵の x 座標 (midi -> x)
  const whiteX = new Map<number, number>()
  whiteKeys.forEach((m, i) => whiteX.set(m, i * whiteWidth))

  // 鍵 m が active か（press 中 or hold sustain 中の midi 集合に含まれるか）
  const sustainSet = playSustain ? new Set(playSustain.midis) : null
  const isActive = (m: number): boolean => {
    if (activeMidis.has(m)) return true
    if (sustainSet && sustainSet.has(m)) return true
    return false
  }
  const isHoldFor = (m: number): boolean => {
    return sustainSet ? sustainSet.has(m) : false
  }

  // ホールド中の色（オレンジ系で通常 active と区別）
  const heldWhiteColor = '#fed7aa'   // tailwind orange-200
  const heldBlackColor = '#c2410c'   // tailwind orange-700
  const activeWhiteColor = '#bae6fd' // tailwind sky-200
  const activeBlackColor = '#0369a1' // tailwind sky-700

  const activeMidiList = Array.from(activeMidis).sort((a, b) => a - b)

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-lab-mute">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">ピアノ鍵盤</span>
          {/* ホールド / シーケンサー / ポリ トグル（全 step 共通の store 状態を切替） */}
          <label
            className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
              keyboardHold ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-lab-line bg-white text-lab-mute hover:bg-slate-50'
            }`}
            title="ON にすると押した鍵が継続発音。同じ鍵を再押下で停止。ポリと併用すると和音ホールド。"
          >
            <input
              type="checkbox"
              checked={keyboardHold}
              onChange={(e) => {
                setKeyboardHold(e.target.checked)
                // フォーカスを外す。フォーカス中だと PC キーボードの note 入力が
                // input 要素扱いで無視されてしまうため、トグル直後に必ず blur する。
                e.target.blur()
              }}
              className="accent-orange-500"
            />
            🔒 ホールド
          </label>
          <label
            className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
              polyMode ? 'opacity-40 cursor-not-allowed' : ''
            } ${
              sequencerEnabled ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-lab-line bg-white text-lab-mute hover:bg-slate-50'
            }`}
            title={polyMode ? 'ポリモード中はシーケンサー不可（相互排他）' : 'ON にすると押した鍵をルートとしてシーケンサーが演奏。'}
          >
            <input
              type="checkbox"
              checked={sequencerEnabled}
              disabled={polyMode}
              onChange={(e) => {
                setSequencerEnabled(e.target.checked)
                e.target.blur()
              }}
              className="accent-emerald-500"
            />
            🎼 シーケンサー
          </label>
          <label
            className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
              sequencerEnabled ? 'opacity-40 cursor-not-allowed' : ''
            } ${
              polyMode ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-lab-line bg-white text-lab-mute hover:bg-slate-50'
            }`}
            title={sequencerEnabled ? 'シーケンサー中はポリ不可（相互排他）' : 'ON にすると最大 8 音同時発音。ホールドと併用で和音ホールド可。'}
          >
            <input
              type="checkbox"
              checked={polyMode}
              disabled={sequencerEnabled}
              onChange={(e) => {
                setPolyMode(e.target.checked)
                e.target.blur()
              }}
              className="accent-violet-500"
            />
            🎹 ポリ(8)
          </label>
        </div>
        <span className="hidden md:inline">PCキーボード: <code className="rounded bg-slate-100 px-1">a w s e d f t g y h u j k o l p ;</code> (C4〜E5)</span>
      </div>
      <div className="touch-none overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${totalWidth} ${whiteHeight}`}
          preserveAspectRatio="xMinYMid meet"
          className="touch-none"
          style={{ width: '100%', maxWidth: totalWidth, height: whiteHeight, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerEnd}
          onPointerCancel={handleSvgPointerEnd}
          onPointerLeave={handleSvgPointerEnd}
        >
          {/* 白鍵 */}
          {whiteKeys.map((m) => {
            const x = whiteX.get(m)!
            const active = isActive(m)
            const fill = active ? (isHoldFor(m) ? heldWhiteColor : activeWhiteColor) : '#ffffff'
            return (
              <g key={`w-${m}`}>
                <rect
                  x={x}
                  y={0}
                  width={whiteWidth}
                  height={whiteHeight}
                  fill={fill}
                  stroke="#94a3b8"
                  strokeWidth={1}
                  data-midi={m}
                  pointerEvents="all"
                  onPointerDown={(e) => handleKeyPointerDown(e, m)}
                  style={{ cursor: 'pointer', touchAction: 'none' }}
                />
                {midiToSolfege(m) && (
                  <text x={x + whiteWidth / 2} y={whiteHeight - 22} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0f172a" pointerEvents="none">
                    {midiToSolfege(m)}
                  </text>
                )}
                <text x={x + whiteWidth / 2} y={whiteHeight - 8} textAnchor="middle" fontSize="10" fill="#64748b" pointerEvents="none">
                  {midiToName(m)}
                </text>
              </g>
            )
          })}
          {/* 黒鍵 */}
          {keys.filter((m) => isBlackKey(m)).map((m) => {
            // 左隣の白鍵の右端寄りに配置
            const prevWhite = m - 1
            const baseX = whiteX.get(prevWhite)
            if (baseX === undefined) return null
            const x = baseX + whiteWidth - blackWidth / 2
            const active = isActive(m)
            const fill = active ? (isHoldFor(m) ? heldBlackColor : activeBlackColor) : '#0f172a'
            return (
              <rect
                key={`b-${m}`}
                x={x}
                y={0}
                width={blackWidth}
                height={blackHeight}
                fill={fill}
                stroke="#0f172a"
                data-midi={m}
                pointerEvents="all"
                onPointerDown={(e) => handleKeyPointerDown(e, m)}
                style={{ cursor: 'pointer', touchAction: 'none' }}
              />
            )
          })}
        </svg>
      </div>
      <div className="mt-2 text-xs text-lab-mute">
        {playSustain ? (
          <>
            <span>ホールド中 ({playSustain.midis.length}音):</span>{' '}
            <span className="font-mono font-semibold text-orange-700">
              {playSustain.midis.map(midiToName).join(' + ')}
            </span>
            <span className="ml-1">🔒</span>
            {playSustain.withSequencer && <span className="ml-1 text-emerald-600">🎼</span>}
          </>
        ) : (
          <>
            <span>{polyMode ? `発音中 (${activeMidiList.length}/8)` : '発音中'}:</span>{' '}
            {activeMidiList.length === 0 ? (
              <span className="font-mono text-lab-mute">None</span>
            ) : activeMidiList.length === 1 ? (
              <>
                <span className="font-mono font-semibold text-lab-ink">{midiToName(activeMidiList[0])}</span>
                {' / '}
                <span className="font-mono">{midiToFreq(activeMidiList[0]).toFixed(1)} Hz</span>
              </>
            ) : (
              <span className="font-mono text-lab-ink">{activeMidiList.map(midiToName).join(' + ')}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
