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
}

export function Keyboard({ startMidi = 48, octaves = 3, onRootChange }: Props) {
  const [activeMidi, setActiveMidi] = useState<number | null>(null)
  const setCurrentFreq = useSynthStore((s) => s.setCurrentFreq)
  const pcBaseMidi = 60 // PCキーボードの "a" を C4 に割当

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

  const press = (midi: number) => {
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
    if (onRootChange) {
      onRootChange(null)
    } else {
      AudioEngine.noteOff()
    }
    setActiveMidi(null)
    setCurrentFreq(null)
  }

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

  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-lab-mute">
        <span className="font-semibold">ピアノ鍵盤</span>
        <span>PCキーボード: <code className="rounded bg-slate-100 px-1">a w s e d f t g y h u j k o l p ;</code> (C4〜E5)</span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${totalWidth} ${whiteHeight}`}
          preserveAspectRatio="xMinYMid meet"
          style={{ width: '100%', maxWidth: totalWidth, height: whiteHeight, touchAction: 'none', userSelect: 'none' }}
        >
          {/* 白鍵 */}
          {whiteKeys.map((m) => {
            const x = whiteX.get(m)!
            const active = activeMidi === m
            return (
              <g key={`w-${m}`}>
                <rect
                  x={x}
                  y={0}
                  width={whiteWidth}
                  height={whiteHeight}
                  fill={active ? '#bae6fd' : '#ffffff'}
                  stroke="#94a3b8"
                  strokeWidth={1}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    ;(e.target as Element).setPointerCapture(e.pointerId)
                    press(m)
                  }}
                  onPointerUp={() => release(m)}
                  onPointerCancel={() => release(m)}
                  style={{ cursor: 'pointer' }}
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
            return (
              <rect
                key={`b-${m}`}
                x={x}
                y={0}
                width={blackWidth}
                height={blackHeight}
                fill={active ? '#0369a1' : '#0f172a'}
                stroke="#0f172a"
                onPointerDown={(e) => {
                  e.preventDefault()
                  ;(e.target as Element).setPointerCapture(e.pointerId)
                  press(m)
                }}
                onPointerUp={() => release(m)}
                onPointerCancel={() => release(m)}
                style={{ cursor: 'pointer' }}
              />
            )
          })}
        </svg>
      </div>
      <div className="mt-2 text-xs text-lab-mute">
        発音中:{' '}
        {activeMidi !== null ? (
          <>
            <span className="font-mono font-semibold text-lab-ink">{midiToName(activeMidi)}</span>
            {' / '}
            <span className="font-mono">{midiToFreq(activeMidi).toFixed(1)} Hz</span>
          </>
        ) : (
          <span className="font-mono text-lab-mute">None</span>
        )}
      </div>
    </div>
  )
}
