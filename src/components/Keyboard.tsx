import { useEffect, useMemo, useRef, useState } from 'react'
import { isBlackKey, midiToFreq, midiToName, midiToSolfege, KEY_TO_MIDI_OFFSET } from '../lib/noteUtils'
import { AudioEngine } from '../audio/AudioEngine'
import { useSynthStore } from '../store/synthStore'

type Props = {
  startMidi?: number    // 一番左の白鍵 (デフォルト C3=48)
  octaves?: number      // オクターブ数
  /**
   * 指定するとデフォルトの AudioEngine 直叩きを抑制し、押下中のルート MIDI を通知する。
   * - 押下: 新しい MIDI（最後に押された鍵）
   * - レガート中の離鍵: 残っている最新の MIDI
   * - 全離鍵: null
   * Step7 ステップシーケンサーで Sequencer.setRoot にバインドして使用。
   */
  onRootChange?: (midi: number | null) => void
  /**
   * ホールドモード。Step7 シーケンサー用の「押した鍵が継続して鳴る」挙動。
   * - 同じ鍵を再押下 → 停止
   * - 別の鍵を押下 → その鍵に root を切替（前のホールドは解除）
   * - キーリリース → 何もしない
   * モード切替時は状態リセット（押している音は止まる）。
   */
  holdMode?: boolean
}

export function Keyboard({ startMidi = 48, octaves = 3, onRootChange, holdMode = false }: Props) {
  const [activeMidi, setActiveMidi] = useState<number | null>(null)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  const pcBaseMidi = 60 // PCキーボードの "a" を C4 に割当
  // SVG への native touchstart リスナを attach するための ref。
  // iOS Safari は inline style の touch-action を無視する版があるため、
  // 直接 touchstart を passive:false で preventDefault する必要がある。
  const svgRef = useRef<SVGSVGElement>(null)
  // ホールドモード時のみ使用。押し続けの heldRef（モノ stack）とは独立に
  // 「セッション中にホールドしている root」を保持する。
  const heldRootRef = useRef<number | null>(null)
  // PC キーボードハンドラは useEffect([]) で 1 回だけ登録されるため、
  // クロージャ越しの holdMode prop は初回マウント時の値を見続けてしまう。
  // ref に最新値を同期しておき、press/release は常にこれを参照する。
  const holdModeRef = useRef(holdMode)
  useEffect(() => {
    holdModeRef.current = holdMode
  }, [holdMode])

  // 鍵盤に含まれる MIDI 番号
  const keys = useMemo(() => {
    const arr: number[] = []
    const totalKeys = 12 * octaves + 1 // 末尾の C を含める
    for (let i = 0; i < totalKeys; i++) arr.push(startMidi + i)
    return arr
  }, [startMidi, octaves])

  const whiteKeys = keys.filter((m) => !isBlackKey(m))

  // 「最後に押された鍵優先」のモノフォニック挙動のため、押下中の鍵を順序保持する
  const heldRef = useRef<number[]>([])
  // タッチ／マウスのドラッグで鍵をまたいだときに「現在指の下にある鍵」を追跡。
  // iOS Safari の setPointerCapture バグ回避のため pointer 1 つだけ追従し、
  // SVG レベルで pointermove を拾ってグライド挙動を実装する。
  const dragMidiRef = useRef<number | null>(null)
  const dragPointerRef = useRef<number | null>(null)

  const press = (midi: number) => {
    if (holdModeRef.current) {
      // 同じ鍵の再押下 → 停止
      if (heldRootRef.current === midi) {
        heldRootRef.current = null
        if (onRootChange) onRootChange(null)
        else AudioEngine.noteOff()
        setActiveMidi(null)
        setCurrentFreq(null)
        return
      }
      // 別の鍵 → root 切替（前のホールドは暗黙的に解除）
      heldRootRef.current = midi
      const freq = midiToFreq(midi)
      if (onRootChange) onRootChange(midi)
      else AudioEngine.noteOn(freq)
      setActiveMidi(midi)
      setCurrentFreq(freq)
      return
    }

    // 通常モード: モノフォニック last-press 優先
    const idx = heldRef.current.indexOf(midi)
    if (idx >= 0) heldRef.current.splice(idx, 1)
    heldRef.current.push(midi)

    const freq = midiToFreq(midi)
    if (onRootChange) {
      onRootChange(midi)
    } else {
      AudioEngine.noteOn(freq)
    }
    setActiveMidi(midi)
    setCurrentFreq(freq)
  }

  const release = (midi: number) => {
    // ホールドモードではキーリリースは何もしない（root は次の press まで継続）
    if (holdModeRef.current) return

    const idx = heldRef.current.indexOf(midi)
    if (idx >= 0) heldRef.current.splice(idx, 1)

    if (heldRef.current.length === 0) {
      if (onRootChange) {
        onRootChange(null)
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
    if (onRootChange) {
      onRootChange(nextMidi)
    } else {
      AudioEngine.setFrequency(nextFreq)
    }
    setActiveMidi(nextMidi)
    setCurrentFreq(nextFreq)
  }

  const releaseAll = () => {
    heldRef.current = []
    heldRootRef.current = null
    dragMidiRef.current = null
    dragPointerRef.current = null
    if (onRootChange) {
      onRootChange(null)
    } else {
      AudioEngine.noteOff()
    }
    setActiveMidi(null)
    setCurrentFreq(null)
  }

  // ドラッグ中に指が別の鍵に乗ったときの遷移。
  // press() を呼ぶと heldRef に新 midi が push されるが、前のドラッグ midi も
  // heldRef に残ったままになるため、ここで明示的に取り除いてからレガート移行する。
  // これによりリリース時に古いドラッグ鍵に「戻る」誤動作を防止する。
  const dragMoveTo = (newMidi: number) => {
    const prev = dragMidiRef.current
    if (prev === newMidi) return
    if (prev !== null) {
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
  // 指が SVG 外で離されたケースは pointerleave 側で先に拾える。
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

  // ホールドモード切替時は鍵盤状態を全リセット（鳴り続け事故防止）。
  // 初回マウントでは何もしない。
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    releaseAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdMode])

  // iOS Safari の SVG タッチイベント不発バグ対策。
  // inline style の touchAction:'none' が iOS 16 以前で無視されるケースがあり、
  // OS が touch を scroll/zoom 候補と判定してしまうと pointerdown 自体が来なくなる。
  // native の touchstart を passive:false で登録し、preventDefault を呼ぶことで
  // 「この領域は OS のジェスチャ対象外」と明示し、pointer events 経路を確実に開通させる。
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
    }
    svg.addEventListener('touchstart', onTouchStart, { passive: false })
    return () => svg.removeEventListener('touchstart', onTouchStart)
  }, [])

  // PC キーボード
  useEffect(() => {
    const downHandler = (e: KeyboardEvent) => {
      if (e.repeat) return
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
    const blurHandler = () => releaseAll()
    window.addEventListener('keydown', downHandler)
    window.addEventListener('keyup', upHandler)
    window.addEventListener('blur', blurHandler)
    return () => {
      window.removeEventListener('keydown', downHandler)
      window.removeEventListener('keyup', upHandler)
      window.removeEventListener('blur', blurHandler)
      // 画面遷移時に発音を確実に停止
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

  // ホールド中の色（青系の通常 active と区別するため amber 系を使用）
  const heldWhiteColor = '#fed7aa'   // tailwind orange-200
  const heldBlackColor = '#c2410c'   // tailwind orange-700
  const activeWhiteColor = '#bae6fd' // tailwind sky-200
  const activeBlackColor = '#0369a1' // tailwind sky-700

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-lab-mute">
        <span className="font-semibold">
          ピアノ鍵盤
          {holdMode && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">🔒 HOLD</span>}
        </span>
        <span>PCキーボード: <code className="rounded bg-slate-100 px-1">a w s e d f t g y h u j k o l p ;</code> (C4〜E5)</span>
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
            const active = activeMidi === m
            const fill = active ? (holdMode ? heldWhiteColor : activeWhiteColor) : '#ffffff'
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
            const active = activeMidi === m
            const fill = active ? (holdMode ? heldBlackColor : activeBlackColor) : '#0f172a'
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
        {holdMode ? 'ホールド中' : '発音中'}:{' '}
        {activeMidi !== null ? (
          <>
            <span className={`font-mono font-semibold ${holdMode ? 'text-orange-700' : 'text-lab-ink'}`}>{midiToName(activeMidi)}</span>
            {' / '}
            <span className="font-mono">{midiToFreq(activeMidi).toFixed(1)} Hz</span>
            {holdMode && <span className="ml-1">🔒</span>}
          </>
        ) : (
          <span className="font-mono text-lab-mute">None</span>
        )}
      </div>
    </div>
  )
}
