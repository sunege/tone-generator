/**
 * Wavetable Synth AudioWorkletProcessor
 * 1周期分の wavetable を線形補間で繰り返し再生する。
 * メッセージプロトコル:
 *   { type: 'wavetable', data: Float32Array }   // 波形差し替え
 *   { type: 'frequency', value: number }        // ピッチ (Hz)
 */
class WavetableProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.table = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      this.table[i] = Math.sin((i / 1024) * Math.PI * 2)
    }
    this.tableSize = 1024
    this.phase = 0
    this.frequency = 440
    this.port.onmessage = (e) => {
      const msg = e.data
      if (!msg) return
      if (msg.type === 'wavetable' && msg.data instanceof Float32Array) {
        this.table = msg.data
        this.tableSize = msg.data.length
      } else if (msg.type === 'frequency' && typeof msg.value === 'number') {
        this.frequency = msg.value
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    const channel = output[0]
    const sr = sampleRate
    const N = this.tableSize
    const inc = (this.frequency * N) / sr

    for (let i = 0; i < channel.length; i++) {
      const idx = this.phase
      const i0 = Math.floor(idx)
      const i1 = (i0 + 1) % N
      const frac = idx - i0
      const sample = this.table[i0] * (1 - frac) + this.table[i1] * frac
      // 全チャンネルに同じ値
      for (let c = 0; c < output.length; c++) {
        output[c][i] = sample
      }
      this.phase += inc
      if (this.phase >= N) this.phase -= N
    }
    return true
  }
}

registerProcessor('wavetable-processor', WavetableProcessor)
