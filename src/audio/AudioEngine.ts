import type { Envelope, FilterEnvelope, FilterType, FxId, LfoParams, LfoTarget, LfoWaveform, SynthPatch } from '../types'
import { triggerAttack, triggerRelease } from './envelope'
import { resetFilterEnvelope, triggerFilterAttack, triggerFilterRelease } from './filterEnvelope'
import { createAllEffects, FxChain, type FxNode } from './fx'

const WORKLET_URL = '/worklet/wavetable-processor.js'
const BITCRUSHER_WORKLET_URL = '/worklet/bitcrusher-processor.js'

type EngineState = {
  ctx: AudioContext
  worklet: AudioWorkletNode
  envGain: GainNode
  lfoAmpGain: GainNode    // LFO の振幅モジュレーション用（基本値 1）
  filter: BiquadFilterNode
  analyserPre: AnalyserNode
  analyserPost: AnalyserNode
  masterGain: GainNode
  lfoOsc: OscillatorNode
  lfoDepth: GainNode
  // フィルター ADSR の出力（filterEnvSource → filterEnvDepth → filter.frequency の additive 経路）
  filterEnvSource: ConstantSourceNode
  filterEnvDepth: GainNode
  detuneParam: AudioParam | null
  // FX チェーン: masterGain → (chainDry | fxChain → chainWet) → analyserOut → destination
  chainDry: GainNode
  chainWet: GainNode
  fxChain: FxChain
  fxNodes: Record<FxId, FxNode>
  analyserOut: AnalyserNode
}

let state: EngineState | null = null
let currentPatch: SynthPatch | null = null
let noteActive = false
let envelopeBypass = false
let filterBypass = false
let lfoBypass = false
let fxChainBypass = true   // デフォルトで FX バイパス（Steps 1-5 は素の音）
// 現在 LFO がどこに接続されているか（disconnect 用）
let lfoConnectedTo: LfoTarget | null = null

const SILENT = 0.0001
const RAW_GAIN = 0.5
const RAW_RAMP = 0.005
const RAW_FILTER_HZ = 20000

// LFO depth (0..1) を target ごとの実スケールへ変換
const LFO_AMP_SWING = 1        // ±1 (lfoAmpGain.gain ベース 1 に加算 → 0..2)
const LFO_FILTER_SWING = 5000  // ±5kHz cutoff sweep
const LFO_PITCH_SWING = 1200   // ±1200 cents (±1 octave)
function depthToGain(target: LfoTarget, depth: number): number {
  const d = Math.max(0, Math.min(1, depth))
  switch (target) {
    case 'amp': return d * LFO_AMP_SWING
    case 'filter': return d * LFO_FILTER_SWING
    case 'pitch': return d * LFO_PITCH_SWING
  }
}

function disconnectLfo() {
  if (!state || lfoConnectedTo === null) return
  try {
    if (lfoConnectedTo === 'amp') {
      state.lfoDepth.disconnect(state.lfoAmpGain.gain)
    } else if (lfoConnectedTo === 'filter') {
      state.lfoDepth.disconnect(state.filter.frequency)
    } else if (lfoConnectedTo === 'pitch' && state.detuneParam) {
      state.lfoDepth.disconnect(state.detuneParam)
    }
  } catch {
    /* ignore — disconnect は対象が一致しないと例外を投げるが、状態は同期している前提 */
  }
  lfoConnectedTo = null
}

function connectLfoTo(target: LfoTarget) {
  if (!state) return
  if (target === 'amp') {
    state.lfoDepth.connect(state.lfoAmpGain.gain)
  } else if (target === 'filter') {
    state.lfoDepth.connect(state.filter.frequency)
  } else if (target === 'pitch' && state.detuneParam) {
    state.lfoDepth.connect(state.detuneParam)
  }
  lfoConnectedTo = target
}

// patch.lfo の現在値と lfoBypass フラグから接続/切断と各 param を更新する
function applyLfo() {
  if (!state || !currentPatch) return
  const t = state.ctx.currentTime
  const lfo = currentPatch.lfo

  state.lfoOsc.type = lfo.waveform as OscillatorType
  state.lfoOsc.frequency.setTargetAtTime(Math.max(0.01, lfo.rate), t, 0.01)
  state.lfoDepth.gain.setTargetAtTime(depthToGain(lfo.target, lfo.depth), t, 0.01)

  const shouldConnect = lfo.enabled && !lfoBypass
  if (shouldConnect) {
    if (lfoConnectedTo !== lfo.target) {
      disconnectLfo()
      connectLfoTo(lfo.target)
    }
  } else {
    disconnectLfo()
  }
}

async function ensureContext(): Promise<EngineState> {
  if (state) return state
  const ctx = new AudioContext()
  await Promise.all([
    ctx.audioWorklet.addModule(WORKLET_URL),
    ctx.audioWorklet.addModule(BITCRUSHER_WORKLET_URL),
  ])
  const worklet = new AudioWorkletNode(ctx, 'wavetable-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })

  const envGain = ctx.createGain()
  envGain.gain.value = 0.0001

  const lfoAmpGain = ctx.createGain()
  lfoAmpGain.gain.value = 1   // LFO で加算モジュレーションする

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

  // LFO (常設、target に応じて connect/disconnect で行き先を切替)
  const lfoOsc = ctx.createOscillator()
  lfoOsc.type = 'sine'
  lfoOsc.frequency.value = 5
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 0
  lfoOsc.connect(lfoDepth)
  lfoOsc.start()

  // フィルター ADSR: ConstantSource(1) → filterEnvDepth(gain=envValue) → filter.frequency
  // additive で base cutoff に envValue が加算される（LFO の filter mod とも併存可）
  const filterEnvSource = ctx.createConstantSource()
  filterEnvSource.offset.value = 1
  const filterEnvDepth = ctx.createGain()
  filterEnvDepth.gain.value = 0
  filterEnvSource.connect(filterEnvDepth)
  filterEnvDepth.connect(filter.frequency)
  filterEnvSource.start()

  // FX チェーン + chainDry / chainWet + analyserOut
  const fxNodes = createAllEffects(ctx, {})  // 初期値は fx.ts 側のデフォルト
  const initialOrder: FxId[] = ['distortion', 'bitcrusher', 'chorus', 'phaser', 'delay', 'reverb']
  const fxChain = new FxChain(ctx, fxNodes, initialOrder)
  const chainDry = ctx.createGain()
  const chainWet = ctx.createGain()
  chainDry.gain.value = 1   // バイパス時: dry=1, wet=0
  chainWet.gain.value = 0
  const analyserOut = ctx.createAnalyser()
  analyserOut.fftSize = 2048
  analyserOut.smoothingTimeConstant = 0.7

  // worklet → envGain → lfoAmpGain → analyserPre → filter → analyserPost → master
  // → (chainDry || fxChain → chainWet) → analyserOut → destination
  worklet.connect(envGain)
  envGain.connect(lfoAmpGain)
  lfoAmpGain.connect(analyserPre)
  analyserPre.connect(filter)
  filter.connect(analyserPost)
  analyserPost.connect(masterGain)
  masterGain.connect(chainDry)
  chainDry.connect(analyserOut)
  masterGain.connect(fxChain.input)
  fxChain.output.connect(chainWet)
  chainWet.connect(analyserOut)
  analyserOut.connect(ctx.destination)

  const detuneParam = (worklet.parameters.get('detune') as AudioParam | undefined) ?? null

  state = {
    ctx, worklet, envGain, lfoAmpGain, filter,
    analyserPre, analyserPost, masterGain,
    lfoOsc, lfoDepth,
    filterEnvSource, filterEnvDepth,
    detuneParam,
    chainDry, chainWet, fxChain, fxNodes, analyserOut,
  }
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
    AudioEngine.setWavetable(initialPatch.wavetable)
    // フィルター初期化（type/Q/cutoff まとめて）
    s.filter.type = initialPatch.filter.type
    s.filter.Q.value = initialPatch.filter.q
    s.filter.frequency.value = initialPatch.filter.cutoff
    applyLfo()
    // FX チェーン初期化（patch 値を全エフェクトに反映）
    s.fxChain.setOrder(initialPatch.fx.order)
    for (const id of Object.keys(initialPatch.fx.fx) as FxId[]) {
      const fxState = initialPatch.fx.fx[id]
      const node = s.fxNodes[id]
      for (const [k, v] of Object.entries(fxState.params)) node.setParam(k, v)
      node.setEnabled(fxState.enabled)
    }
  },

  setWavetable(buf: Float32Array) {
    if (currentPatch) currentPatch.wavetable = buf
    if (!state) return
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
    if (filterBypass) return
    const clamped = Math.max(20, Math.min(20000, hz))
    state.filter.frequency.setTargetAtTime(clamped, state.ctx.currentTime, 0.01)
  },

  setFilterType(type: FilterType) {
    if (currentPatch) currentPatch.filter.type = type
    if (!state) return
    if (filterBypass) return  // バイパス中は lowpass 固定（透過）
    state.filter.type = type as BiquadFilterType
  },

  setFilterQ(q: number) {
    if (currentPatch) currentPatch.filter.q = q
    if (!state) return
    if (filterBypass) return
    const clamped = Math.max(0.0001, Math.min(40, q))
    state.filter.Q.setTargetAtTime(clamped, state.ctx.currentTime, 0.01)
  },

  setEnvelopeBypass(enabled: boolean) {
    envelopeBypass = enabled
  },

  setFilterBypass(enabled: boolean) {
    filterBypass = enabled
    if (!state || !currentPatch) return
    const t = state.ctx.currentTime
    if (enabled) {
      // バイパス: 透過状態（lowpass 20kHz / Q=0）+ filter envelope の寄与も 0 に戻す
      state.filter.type = 'lowpass'
      state.filter.Q.setTargetAtTime(0.0001, t, 0.01)
      state.filter.frequency.setTargetAtTime(RAW_FILTER_HZ, t, 0.01)
      resetFilterEnvelope(state.filterEnvDepth.gain, t)
    } else {
      // 解除: patch の type/Q/cutoff を復元
      state.filter.type = currentPatch.filter.type as BiquadFilterType
      state.filter.Q.setTargetAtTime(currentPatch.filter.q, t, 0.01)
      state.filter.frequency.setTargetAtTime(currentPatch.filter.cutoff, t, 0.01)
    }
  },

  setLfo(partial: Partial<LfoParams>) {
    if (!currentPatch) return
    currentPatch.lfo = { ...currentPatch.lfo, ...partial }
    applyLfo()
  },

  setFilterEnvelope(partial: Partial<FilterEnvelope>) {
    if (!currentPatch) return
    const next: FilterEnvelope = { ...currentPatch.filterEnvelope, ...partial }
    currentPatch.filterEnvelope = next
    if (!state) return
    // 無効化／バイパス中は即 0 に戻す（depth・ADSR 数値だけの編集は次の noteOn から反映）
    if (!next.enabled || filterBypass) {
      resetFilterEnvelope(state.filterEnvDepth.gain, state.ctx.currentTime)
    }
  },

  // ピッチベンド: cents 単位で worklet の detune を直接書く。
  // LFO が pitch を target にしている場合は LFO 出力がこの base 値に加算される（natural）。
  setPitchBend(cents: number) {
    if (!state || !state.detuneParam) return
    state.detuneParam.setTargetAtTime(cents, state.ctx.currentTime, 0.005)
  },

  // FX チェーン全体のバイパス（Step6 入退室時に切替）
  setFxChainBypass(enabled: boolean) {
    fxChainBypass = enabled
    if (!state) return
    const t = state.ctx.currentTime
    state.chainDry.gain.setTargetAtTime(enabled ? 1 : 0, t, 0.02)
    state.chainWet.gain.setTargetAtTime(enabled ? 0 : 1, t, 0.02)
  },

  setFxEnabled(id: FxId, enabled: boolean) {
    if (currentPatch) currentPatch.fx.fx[id].enabled = enabled
    if (!state) return
    state.fxNodes[id].setEnabled(enabled)
  },

  setFxParam(id: FxId, name: string, value: number) {
    if (currentPatch) currentPatch.fx.fx[id].params[name] = value
    if (!state) return
    state.fxNodes[id].setParam(name, value)
  },

  setFxOrder(order: FxId[]) {
    if (currentPatch) currentPatch.fx.order = [...order]
    if (!state) return
    state.fxChain.setOrder(order)
  },

  setLfoBypass(enabled: boolean) {
    lfoBypass = enabled
    applyLfo()
  },

  setFrequency(freq: number) {
    if (!state) return
    state.worklet.port.postMessage({ type: 'frequency', value: freq })
  },

  noteOn(freq: number) {
    if (!state || !currentPatch) return
    const t = state.ctx.currentTime
    state.worklet.port.postMessage({ type: 'frequency', value: freq })
    // フィルター ADSR: 有効 & フィルターバイパスでなければトリガ（envelopeBypass とは独立）
    if (currentPatch.filterEnvelope.enabled && !filterBypass) {
      triggerFilterAttack(state.filterEnvDepth.gain, currentPatch.filterEnvelope, t + 0.001)
    }
    if (envelopeBypass) {
      const g = state.envGain.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(Math.max(SILENT, g.value), t)
      g.linearRampToValueAtTime(RAW_GAIN, t + RAW_RAMP)
      noteActive = true
      return
    }
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
    if (currentPatch.filterEnvelope.enabled && !filterBypass) {
      triggerFilterRelease(state.filterEnvDepth.gain, currentPatch.filterEnvelope, t)
    }
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
  getAnalyserOut(): AnalyserNode | null {
    return state?.analyserOut ?? null
  },
  getContext(): AudioContext | null {
    return state?.ctx ?? null
  },
}

void fxChainBypass  // 参照は setFxChainBypass 内

// 型補助: LfoWaveform は OscillatorType と完全互換（'sine'|'triangle'|'sawtooth'|'square'）
const _typeCheck: LfoWaveform = 'sine'
void _typeCheck
