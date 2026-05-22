import { AudioEngine } from './AudioEngine'

type MicState = {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
}

const FFT_SIZE = 4096

let state: MicState | null = null

export const MicSource = {
  isEnabled(): boolean {
    return state !== null
  },

  async enable(): Promise<void> {
    if (state) return
    const ctx = AudioEngine.getContext()
    if (!ctx) {
      throw new Error('AudioContext がまだ初期化されていません')
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('このブラウザは getUserMedia に対応していません')
    }
    // getUserMedia は HTTPS / localhost でのみ動作する
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = 0
    // destination には繋がない（マイク音をスピーカーに流すとフィードバックの原因）
    source.connect(analyser)
    state = { stream, source, analyser }
  },

  disable(): void {
    if (!state) return
    try {
      state.source.disconnect()
    } catch {
      /* ignore */
    }
    state.stream.getTracks().forEach((t) => t.stop())
    state = null
  },

  getAnalyser(): AnalyserNode | null {
    return state?.analyser ?? null
  },

  /** 現時点の時間領域バッファ（コピー）を取得 */
  getRecentBuffer(): Float32Array<ArrayBuffer> | null {
    if (!state) return null
    const N = state.analyser.fftSize
    const buf = new Float32Array(new ArrayBuffer(N * 4))
    state.analyser.getFloatTimeDomainData(buf)
    return buf
  },
}
