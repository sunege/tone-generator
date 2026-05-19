import type { Envelope, SynthPatch } from '../types'
import { triggerAttack, triggerRelease } from './envelope'

const WORKLET_URL = '/worklet/wavetable-processor.js'

type EngineState = {
  ctx: AudioContext
  worklet: AudioWorkletNode
  envGain: GainNode
  filter: BiquadFilterNode
  analyserPre: AnalyserNode
  analyserPost: AnalyserNode
  masterGain: GainNode
}

let state: EngineState | null = null
let currentPatch: SynthPatch | null = null
let noteActive = false
// ADSR をバイパスして固定ゲインで発音するフラグ
let envelopeBypass = false
// フィルターをバイパスして 20kHz に開放するフラグ
let filterBypass = false

const SILENT = 0.0001
const RAW_GAIN = 0.5      // raw モード時の固定ゲイン
const RAW_RAMP = 0.005    // クリック回避用の短いランプ秒
const RAW_FILTER_HZ = 20000

async function ensureContext(): Promise<EngineState> {
  if (state) return state
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(WORKLET_URL)
  const worklet = new AudioWorkletNode(ctx, 'wavetable-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })

  const envGain = ctx.createGain()
  envGain.gain.value = 0.0001 // start silent

  const analyserPre = ctx.createAnalyser()
  analyserPre.fftSize = 2048
  analyserPre.smoothingTimeConstant = 0.7

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 12000
  filter.Q.value = 0.0001

  const analyserPost = ctx.createAnalyser()
  analyserPost.fftSize = 2048
  analyserPost.smoothingTimeConstant = 0.7

  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.5

  // Wiring: worklet -> envGain -> analyserPre -> filter -> analyserPost -> master -> destination
  worklet.connect(envGain)
  envGain.connect(analyserPre)
  analyserPre.connect(filter)
  filter.connect(analyserPost)
  analyserPost.connect(masterGain)
  masterGain.connect(ctx.destination)

  state = { ctx, worklet, envGain, filter, analyserPre, analyserPost, masterGain }
  return state
}

export const AudioEngine = {
  isReady(): boolean {
    return state !== null
  },

  async start(initialPatch: SynthPatch) {
    const s = await ensureContext()
    if (s.ctx.state === 'suspended') await s.ctx.resume()
    currentPatch = initialPatch
    // 初期波形・フィルターを送る
    AudioEngine.setWavetable(initialPatch.wavetable)
    AudioEngine.setCutoff(initialPatch.filter.cutoff)
  },

  setWavetable(buf: Float32Array) {
    if (currentPatch) currentPatch.wavetable = buf
    if (!state) return
    // Worklet にコピーして送る（store も保持するため transfer は使わない）
    const copy = new Float32Array(buf.length)
    copy.set(buf)
    state.worklet.port.postMessage({ type: 'wavetable', data: copy })
  },

  setEnvelope(env: Envelope) {
    if (currentPatch) currentPatch.envelope = env
  },

  setCutoff(hz: number) {
    if (currentPatch) currentPatch.filter.cutoff = hz
    if (!state) return
    // バイパス中はフィルターを開いたままにし、設定値だけ patch に保持する
    if (filterBypass) return
    const clamped = Math.max(20, Math.min(20000, hz))
    state.filter.frequency.setTargetAtTime(clamped, state.ctx.currentTime, 0.01)
  },

  setEnvelopeBypass(enabled: boolean) {
    envelopeBypass = enabled
  },

  setFilterBypass(enabled: boolean) {
    filterBypass = enabled
    if (!state || !currentPatch) return
    const t = state.ctx.currentTime
    const target = enabled ? RAW_FILTER_HZ : currentPatch.filter.cutoff
    state.filter.frequency.cancelScheduledValues(t)
    state.filter.frequency.setTargetAtTime(target, t, 0.01)
  },

  setFrequency(freq: number) {
    if (!state) return
    state.worklet.port.postMessage({ type: 'frequency', value: freq })
  },

  noteOn(freq: number) {
    if (!state || !currentPatch) return
    const t = state.ctx.currentTime
    state.worklet.port.postMessage({ type: 'frequency', value: freq })
    if (envelopeBypass) {
      // エンベロープなし: 短いランプで一定ゲインへ
      const g = state.envGain.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(Math.max(SILENT, g.value), t)
      g.linearRampToValueAtTime(RAW_GAIN, t + RAW_RAMP)
      noteActive = true
      return
    }
    // 既存ノートが鳴っていたら一旦リリースしてから再アタック
    if (noteActive) {
      triggerRelease(state.envGain.gain, currentPatch.envelope, t)
    }
    triggerAttack(state.envGain.gain, currentPatch.envelope, t + 0.001)
    noteActive = true
  },

  noteOff() {
    if (!state || !currentPatch) return
    if (!noteActive) return
    const t = state.ctx.currentTime
    if (envelopeBypass) {
      const g = state.envGain.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(Math.max(SILENT, g.value), t)
      g.linearRampToValueAtTime(SILENT, t + RAW_RAMP * 2)
    } else {
      triggerRelease(state.envGain.gain, currentPatch.envelope, t)
    }
    noteActive = false
  },

  getAnalyserPre(): AnalyserNode | null {
    return state?.analyserPre ?? null
  },
  getAnalyserPost(): AnalyserNode | null {
    return state?.analyserPost ?? null
  },
  getContext(): AudioContext | null {
    return state?.ctx ?? null
  },
}
