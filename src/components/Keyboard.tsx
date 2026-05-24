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
 * 2 つのトグル（store: keyboardHold / sequencerEnabled）を内部ヘッダーに表示。
 *  - ホールド ON: 同じ鍵を再押下するまで音が止まらない。step を跨いでも継続。
 *  - シーケンサー ON: 押下した鍵をルートとしてシーケンサーが演奏。
 *  - 両方 ON: ホールドかつシーケンサーで step 遷移後も演奏継続。
 *
 * ホールド演奏中（playSustain != null）は AudioEngine.setSustainOverride(true) によって
 * envelope/filter/lfo/fxChain の bypass 要求がすべて無視され、フルチェーン再生になる。
 * これにより step 1（波形のみ）に移動しても ADSR/FX が効いた音が鳴り続ける。
 */
export function Keyboard({ startMidi = 48, octaves = 3 }: Props) {
  const [activeMidi, setActiveMidi] = useState<number | null>(null)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  const keyboardHold = useSynthStore((s) => s.keyboardHold)
  const sequencerEnabled = useSynthStore((s) => s.sequencerEnabled)
  const playSustain = useSynthStore((s) => s.playSustain)
  const setKeyboardHold = useSynthStore((s) => s.setKeyboardHold)
  const setSequencerEnabled = useSynthStore((s) => s.setSequencerEnabled)
  const startSustain = useSynthStore((s) => s.startSustain)
  const pcBaseMidi = 60 // PCキーボードの "a" を C4 に割当

  // SVG への native touchstart リスナを attach するための ref。
  // iOS Safari は inline style の touch-action を無視する版があるため、
  // 直接 touchstart を passive:false で preventDefault する必要がある。
  const svgRef = useRef<SVGSVGElement>(null)

  // PC キーボードハンドラは useEffect([]) で 1 回だけ登録される。
  // store の最新値を参照したいので ref に常時同期。
  const holdRef = useRef(keyboardHold)
  const seqRef = useRef(sequencerEnabled)
  useEffect(() => { holdRef.current = keyboardHold }, [keyboardHold])
  useEffect(() => { seqRef.current = sequencerEnabled }, [sequencerEnabled])

  // 鍵盤に含まれる MIDI 番号
  const keys = useMemo(() => {
    const arr: number[] = []
    const totalKeys = 12 * octaves + 1 // 末尾の C を含める
    for (let i = 0; i < totalKeys; i++) arr.push(startMidi + i)
    return arr
  }, [startMidi, octaves])

  const whiteKeys = keys.filter((m) => !isBlackKey(m))

  // 「最後に押された鍵優先」のモノフォニック挙動のため、押下中の鍵を順序保持する。
  // 非ホールドモードでのみ使用。
  const heldRef = useRef<number[]>([])
  // タッチ／マウスのドラッグで鍵をまたいだときに「現在指の下にある鍵」を追跡。
  // iOS Safari の setPointerCapture バグ回避のため pointer 1 つだけ追従し、
  // SVG レベルで pointermove を拾ってグライド挙動を実装する。
  const dragMidiRef = useRef<number | null>(null)
  const dragPointerRef = useRef<number | null>(null)

  const press = (midi: number) => {
    // ホールドモード: store 経由で sustain を起動・切替・停止（同 midi なら停止）
    if (holdRef.current) {
      startSustain(midi)
      return
    }

    // 通常モード: モノフォニック last-press 優先
    const idx = heldRef.current.indexOf(midi)
    if (idx >= 0) heldRef.current.splice(idx, 1)
    heldRef.current.push(midi)

    const freq = midiToFreq(midi)
    if (seqRef.current) {
      Sequencer.setRoot(midi)
    } else {
      AudioEngine.noteOn(freq)
    }
    setActiveMidi(midi)
    setCurrentFreq(freq)
  }

  const release = (midi: number) => {
    // ホールドモードではキーリリースは何もしない（root は次の press まで継続）
    if (holdRef.current) return

    const idx = heldRef.current.indexOf(midi)
    if (idx >= 0) heldRef.current.splice(idx, 1)

    if (heldRef.current.length === 0) {
      if (seqRef.current) {
        Sequencer.setRoot(null)
      } else {
        AudioEngine.noteOff()
      }
      setActiveMidi(null)
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
    setActiveMidi(nextMidi)
    setCurrentFreq(nextFreq)
  }

  const releaseAll = () => {
    heldRef.current = []
    dragMidiRef.current = null
    dragPointerRef.current = null
    if (holdRef.current) return  // ホールド中の演奏は維持する
    if (seqRef.current) {
      Sequencer.setRoot(null)
    } else {
      AudioEngine.noteOff()
    }
    setActiveMidi(null)
    setCurrentFreq(null)
  }

  // ドラッグ中に指が別の鍵に乗ったときの遷移。
  // 非ホールド時はリリース時に古いドラッグ鍵へ「戻る」誤動作を防ぐため heldRef から除去。
  // ホールド時は store の switchSustainRoot が直接呼ばれるので heldRef を触らない。
  const dragMoveTo = (newMidi: number) => {
    const prev = dragMidiRef.current
    if (prev === newMidi) return
    if (prev !== null && !holdRef.current) {
      const idx = heldRef.current.indexOf(prev)
      if (idx >= 0) heldRef.current.splice(idx, 1)
    }
    dragMidiRef.current = newMidi
    press(newMidi)
  }

  // SVG レベルの pointermove。data-midi 属性つきの rect の上に指がきたら遷移する。
  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragPointerRef.current === null) return
    if (e.pointerId !== dragPointerRef.current) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!(el instanceof Element)) return
    const attr = el.getAttribute('data-midi')
    if (!attr) return
    const newMidi = parseInt(attr, 10)
    if (Number.isNaN(newMidi)) return
    dragMoveTo(newMidi)
  }

  // pointerup / pointerleave / pointercancel いずれもドラッグ終了として扱う。
  const handleSvgPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragPointerRef.current === null) return
    if (e.pointerId !== dragPointerRef.current) return
    const midi = dragMidiRef.current
    dragPointerRef.current = null
    dragMidiRef.current = null
    if (midi !== null) release(midi)
  }

  // 個別の鍵 rect から呼ばれる押下処理（ドラッグの起点登録）。
  // 2 本目以降の指は無視（モノフォニック）。
  const handleKeyPointerDown = (e: React.PointerEvent<SVGElement>, midi: number) => {
    e.preventDefault()
    if (dragPointerRef.current !== null) return
    dragPointerRef.current = e.pointerId
    dragMidiRef.current = midi
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

  // hold / sequencer のトグル切替時、通常モードで押下中だった音を確実に止める。
  // 設定を切り替えると release ロジックのルーティング先が変わって、
  // 古い経路で開始されたノートが新しい経路で止まらなくなる（鳴り続け事故）。
  // 両方の停止 API は no-op safe なので両方呼んで掃除する。
  // ホールド演奏（store の playSustain）には触らない — そちらは store 側で管理。
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    if (heldRef.current.length > 0) {
      heldRef.current = []
      AudioEngine.noteOff()
      Sequencer.setRoot(null)
      setActiveMidi(null)
      setCurrentFreq(null)
    }
  }, [keyboardHold, sequencerEnabled, setCurrentFreq])

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

  // 表示中の MIDI: ホールド演奏中なら sustain の midi を優先。それ以外はローカル activeMidi。
  const displayMidi = playSustain ? playSustain.midi : activeMidi
  const isHoldDisplay = playSustain !== null

  // ホールド中の色（青系の通常 active と区別するため amber 系を使用）
  const heldWhiteColor = '#fed7aa'   // tailwind orange-200
  const heldBlackColor = '#c2410c'   // tailwind orange-700
  const activeWhiteColor = '#bae6fd' // tailwind sky-200
  const activeBlackColor = '#0369a1' // tailwind sky-700

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-lab-mute">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">ピアノ鍵盤</span>
          {/* ホールド / シーケンサー トグル（全 step 共通の store 状態を切替） */}
          <label
            className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
              keyboardHold ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-lab-line bg-white text-lab-mute hover:bg-slate-50'
            }`}
            title="ON にすると押した鍵が継続発音。同じ鍵を再押下で停止。step 切替後も継続。"
          >
            <input
              type="checkbox"
              checked={keyboardHold}
              onChange={(e) => setKeyboardHold(e.target.checked)}
              className="accent-orange-500"
            />
            🔒 ホールド
          </label>
          <label
            className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
              sequencerEnabled ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-lab-line bg-white text-lab-mute hover:bg-slate-50'
            }`}
            title="ON にすると押した鍵をルートとしてシーケンサーが演奏。OFF なら単音。"
          >
            <input
              type="checkbox"
              checked={sequencerEnabled}
              onChange={(e) => setSequencerEnabled(e.target.checked)}
              className="accent-emerald-500"
            />
            🎼 シーケンサー
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
            const active = displayMidi === m
            const fill = active ? (isHoldDisplay ? heldWhiteColor : activeWhiteColor) : '#ffffff'
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
            const active = displayMidi === m
            const fill = active ? (isHoldDisplay ? heldBlackColor : activeBlackColor) : '#0f172a'
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
        {isHoldDisplay ? 'ホールド中' : '発音中'}:{' '}
        {displayMidi !== null ? (
          <>
            <span className={`font-mono font-semibold ${isHoldDisplay ? 'text-orange-700' : 'text-lab-ink'}`}>{midiToName(displayMidi)}</span>
            {' / '}
            <span className="font-mono">{midiToFreq(displayMidi).toFixed(1)} Hz</span>
            {isHoldDisplay && <span className="ml-1">🔒</span>}
            {playSustain?.withSequencer && <span className="ml-1 text-emerald-600">🎼</span>}
          </>
        ) : (
          <span className="font-mono text-lab-mute">None</span>
        )}
      </div>
    </div>
  )
}
