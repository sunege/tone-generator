/**
 * 自己相関による基本周波数推定。
 * - 探索範囲: 80Hz - 1000Hz（人声・口笛・一般楽器の中域に十分）
 * - lag=0 の自己相関で正規化し、信頼度が低い場合は null を返す
 * - 検出した lag は前後ビンの線形補間で sub-sample 精度に refine
 *
 * 注意: O(N * lagRange) なので頻繁に呼ばないこと。キャプチャ時 1 回だけ呼ぶ想定。
 */

const PITCH_MIN_HZ = 80
const PITCH_MAX_HZ = 1000
const RMS_MIN = 0.01            // この音量未満は静音とみなす
const CONFIDENCE_MIN = 0.5      // 正規化自己相関のしきい値

export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  const N = buf.length

  // RMS で音量チェック
  let sumSq = 0
  for (let i = 0; i < N; i++) sumSq += buf[i] * buf[i]
  const rms = Math.sqrt(sumSq / N)
  if (rms < RMS_MIN) return null

  const minLag = Math.max(2, Math.floor(sampleRate / PITCH_MAX_HZ))
  const maxLag = Math.min(N - 1, Math.floor(sampleRate / PITCH_MIN_HZ))
  if (minLag >= maxLag) return null

  // lag=0 自己相関 (= sumSq) で後ほど正規化
  const lag0 = sumSq

  // 各 lag の正規化自己相関を計算
  let bestLag = -1
  let bestCorr = 0
  const corrs: number[] = new Array(maxLag + 1).fill(0)

  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    const end = N - lag
    for (let i = 0; i < end; i++) s += buf[i] * buf[i + lag]
    corrs[lag] = s
    if (s > bestCorr) {
      bestCorr = s
      bestLag = lag
    }
  }

  if (bestLag < 0) return null
  const normalized = bestCorr / lag0
  if (normalized < CONFIDENCE_MIN) return null

  // パラボラ補間で sub-sample 精度に refine
  let refinedLag = bestLag
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = corrs[bestLag - 1]
    const y1 = corrs[bestLag]
    const y2 = corrs[bestLag + 1]
    const denom = y0 - 2 * y1 + y2
    if (Math.abs(denom) > 1e-9) {
      const shift = 0.5 * (y0 - y2) / denom
      refinedLag = bestLag + shift
    }
  }

  return sampleRate / refinedLag
}
