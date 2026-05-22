/**
 * Bitcrusher AudioWorkletProcessor
 * - bits: 量子化ビット数 (1..16)。小さいほど階段状で粗い
 * - downsample: サンプル保持回数 (1..32)。N サンプルごとに 1 つだけ更新（疑似的なサンプルレート低下）
 *
 * 教育的ポイント:
 *   デジタル音響の 2 大要素「量子化精度」と「サンプリングレート」を意図的に下げると
 *   どう音が変化するかを体験できる（ローファイ / ファミコン風の音色）。
 */
class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 4, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.holdCounter = 0
    this.heldSamples = []  // チャンネルごとの保持値
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true

    const bits = Math.max(1, Math.min(16, parameters.bits[0]))
    const downsample = Math.max(1, Math.floor(parameters.downsample[0]))
    // 量子化ステップ。bits=16 でほぼ連続、bits=1 で {-1, +1} の二値
    const levels = Math.pow(2, bits - 1)
    const step = 1 / levels

    // チャンネル数に合わせて heldSamples を初期化
    while (this.heldSamples.length < input.length) this.heldSamples.push(0)

    const blockSize = input[0].length
    for (let i = 0; i < blockSize; i++) {
      if (this.holdCounter === 0) {
        for (let ch = 0; ch < input.length; ch++) {
          const x = input[ch][i]
          // 量子化（中点丸め）
          this.heldSamples[ch] = step * Math.round(x / step)
        }
      }
      for (let ch = 0; ch < output.length; ch++) {
        const src = ch < this.heldSamples.length ? this.heldSamples[ch] : 0
        output[ch][i] = src
      }
      this.holdCounter++
      if (this.holdCounter >= downsample) this.holdCounter = 0
    }
    return true
  }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor)
