/**
 * バッファから1周期分の波形を抽出して targetLen サンプルにリサンプルする。
 * - ゼロクロス（負→正）でトリガーを取り、位相を揃える
 * - 検出できる複数周期を周期同期平均してノイズを低減
 * - 最後に振幅を ±1 に正規化
 */
export function extractPeriod(
  buf: Float32Array,
  periodSamples: number,
  targetLen = 1024,
): Float32Array {
  const N = buf.length
  if (periodSamples <= 1 || N < periodSamples * 2) {
    return resampleAndNormalize(buf, targetLen)
  }

  // ゼロクロス（負→正）を線形補間で sub-sample 精度に決定
  let trigger = -1
  const searchEnd = Math.floor(N - periodSamples - 1)
  for (let i = 1; i < searchEnd; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) {
      const frac = -buf[i - 1] / (buf[i] - buf[i - 1] || 1e-9)
      trigger = i - 1 + frac
      break
    }
  }
  if (trigger < 0) trigger = 0

  // トリガーから先に詰まる周期数（最低1）
  const available = Math.floor((N - trigger - 1) / periodSamples)
  const numPeriods = Math.max(1, available)

  // 1周期を targetLen サンプルにリサンプルしながら平均
  const out = new Float32Array(targetLen)
  for (let p = 0; p < numPeriods; p++) {
    const baseStart = trigger + p * periodSamples
    for (let i = 0; i < targetLen; i++) {
      const pos = baseStart + (i / targetLen) * periodSamples
      const i0 = Math.floor(pos)
      const i1 = Math.min(N - 1, i0 + 1)
      const frac = pos - i0
      out[i] += buf[i0] * (1 - frac) + buf[i1] * frac
    }
  }
  for (let i = 0; i < targetLen; i++) out[i] /= numPeriods

  // 直流成分除去（平均を引く）
  let mean = 0
  for (let i = 0; i < targetLen; i++) mean += out[i]
  mean /= targetLen
  for (let i = 0; i < targetLen; i++) out[i] -= mean

  // 振幅正規化
  let peak = 0
  for (let i = 0; i < targetLen; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  if (peak > 0) {
    for (let i = 0; i < targetLen; i++) out[i] /= peak
  }
  return out
}

/**
 * 任意の範囲 [start, end) を 1 周期とみなして targetLen にリサンプル + DC除去 + 正規化。
 * マーカー手動カット用。
 */
export function extractRange(
  src: Float32Array,
  start: number,
  end: number,
  targetLen = 1024,
): Float32Array {
  const out = new Float32Array(targetLen)
  const length = end - start
  if (length <= 1) return out

  for (let i = 0; i < targetLen; i++) {
    const pos = start + (i / targetLen) * length
    const i0 = Math.floor(pos)
    const i1 = Math.min(src.length - 1, Math.max(0, i0 + 1))
    const ic = Math.min(src.length - 1, Math.max(0, i0))
    const frac = pos - i0
    out[i] = src[ic] * (1 - frac) + src[i1] * frac
  }

  let mean = 0
  for (let i = 0; i < targetLen; i++) mean += out[i]
  mean /= targetLen
  for (let i = 0; i < targetLen; i++) out[i] -= mean

  let peak = 0
  for (let i = 0; i < targetLen; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  if (peak > 0) {
    for (let i = 0; i < targetLen; i++) out[i] /= peak
  }
  return out
}

function resampleAndNormalize(src: Float32Array, targetLen: number): Float32Array {
  const out = new Float32Array(targetLen)
  const N = src.length
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / targetLen) * N
    const i0 = Math.floor(pos)
    const i1 = Math.min(N - 1, i0 + 1)
    const frac = pos - i0
    out[i] = src[i0] * (1 - frac) + src[i1] * frac
  }
  let peak = 0
  for (let i = 0; i < targetLen; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  if (peak > 0) {
    for (let i = 0; i < targetLen; i++) out[i] /= peak
  }
  return out
}
