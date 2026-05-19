import { create, all } from 'mathjs'
import { WAVETABLE_SIZE } from '../types'

const math = create(all)

export type ParseResult =
  | { ok: true; wavetable: Float32Array }
  | { ok: false; error: string }

export function parseFormulaToWavetable(expr: string): ParseResult {
  const trimmed = expr.trim()
  if (!trimmed) return { ok: false, error: '数式を入力してください' }

  let compiled
  try {
    compiled = math.parse(trimmed).compile()
  } catch (e) {
    return { ok: false, error: `数式エラー: ${(e as Error).message}` }
  }

  const N = WAVETABLE_SIZE
  const TAU = Math.PI * 2
  const out = new Float32Array(N)
  let max = 0

  try {
    for (let i = 0; i < N; i++) {
      const x = (i / N) * TAU
      const v = compiled.evaluate({ x })
      if (typeof v !== 'number' || !isFinite(v)) {
        return { ok: false, error: '数値以外の結果が返されました' }
      }
      out[i] = v
      if (Math.abs(v) > max) max = Math.abs(v)
    }
  } catch (e) {
    return { ok: false, error: `評価エラー: ${(e as Error).message}` }
  }

  if (max === 0) {
    return { ok: true, wavetable: out }
  }
  for (let i = 0; i < N; i++) out[i] /= max
  return { ok: true, wavetable: out }
}
