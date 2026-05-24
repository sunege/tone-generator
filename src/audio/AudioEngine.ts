import type { Envelope, FilterEnvelope, FilterType, FxId, LfoParams, LfoTarget, LfoWaveform, SynthPatch } from '../types'
import { triggerAttack, triggerRelease } from './envelope'
import { resetFilterEnvelope, triggerFilterAttack, triggerFilterRelease } from './filterEnvelope'
import { createAllEffects, FxChain, type FxNode } from './fx'

const WORKLET_URL = '/worklet/wavetable-processor.js'
const BITCRUSHER_WORKLET_URL = '/worklet/bitcrusher-processor.js'

type LfoSlot = 1 | 2

type EngineState = {
  ctx: AudioContext
  worklet: AudioWorkletNode
  envGain: GainNode
  lfoAmpGain: GainNode    // LFO の振幅モジュレーション用（基本値 1）
  filter: BiquadFilterNode
  analyserPre: AnalyserNode
  analyserPost: AnalyserNode
  masterGain: GainNode
  // LFO スロット 2 つ。両者とも常設で、行き先（target）に応じて
  // connect/disconnect で動的に挿げ替える。同じ target を選んでも自然に加算される。
  lfoOsc: OscillatorNode
  lfoDepth: GainNode
  lfoOsc2: OscillatorNode
  lfoDepth2: GainNode
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
// 実際にエンジンに適用されている bypass 値（後述の sustainOverride による override 反映後）
let envelopeBypass = false
let filterBypass = false
let lfoBypass = false
let fxChainBypass = true   // デフォルトで FX バイパス（Steps 1-5 は素の音）
// 各 step useEffect が「設計上こうしたい」と要求した bypass 値を保持。
// sustainOverride 中は実際の bypass はすべて false に強制されるが、
// override 解除時にこの requested 値に戻す。
let requestedEnvelopeBypass = false
let requestedFilterBypass = false
let requestedLfoBypass = false
let requestedFxChainBypass = true
// 「ホールド演奏中はチェーンをフルにして bypass 要求を無視する」モード。
// step 遷移しても演奏が継続するようにするため、各 step の bypass 設定を上書きする。
let sustainOverride = false
// スロットごとに「現在どこに接続されているか」を覚えておく（正しく disconnect するため）
const lfoConnectedTo: (LfoTarget | null)[] = [null, null]

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

function getSlotNodes(slot: LfoSlot): { osc: OscillatorNode; depth: GainNode } | null {
  if (!state) return null
  return slot === 1
    ? { osc: state.lfoOsc, depth: state.lfoDepth }
    : { osc: state.lfoOsc2, depth: state.lfoDepth2 }
}

function disconnectLfo(slot: LfoSlot) {
  if (!state) return
  const connected = lfoConnectedTo[slot - 1]
  if (connected === null) return
  const nodes = getSlotNodes(slot)
  if (!nodes) return
  try {
    if (connected === 'amp') nodes.depth.disconnect(state.lfoAmpGain.gain)
    else if (connected === 'filter') nodes.depth.disconnect(state.filter.frequency)
    else if (connected === 'pitch' && state.detuneParam) nodes.depth.disconnect(state.detuneParam)
  } catch {
    /* ignore — disconnect は対象が一致しないと例外を投げるが、状態は同期している前提 */
  }
  lfoConnectedTo[slot - 1] = null
}

function connectLfoTo(slot: LfoSlot, target: LfoTarget) {
  if (!state) return
  const nodes = getSlotNodes(slot)
  if (!nodes) return
  if (target === 'amp') nodes.depth.connect(state.lfoAmpGain.gain)
  else if (target === 'filter') nodes.depth.connect(state.filter.frequency)
  else if (target === 'pitch' && state.detuneParam) nodes.depth.connect(state.detuneParam)
  lfoConnectedTo[slot - 1] = target
}

// patch.lfo / patch.lfo2 の現在値と lfoBypass フラグから接続/切断と各 param を更新する
function applyLfoSlot(slot: LfoSlot) {
  if (!state || !currentPatch) return
  const t = state.ctx.currentTime
  const lfo = slot === 1 ? currentPatch.lfo : currentPatch.lfo2
  const nodes = getSlotNodes(slot)
  if (!nodes) return

  nodes.osc.type = lfo.waveform as OscillatorType
  nodes.osc.frequency.setTargetAtTime(Math.max(0.01, lfo.rate), t, 0.01)
  nodes.depth.gain.setTargetAtTime(depthToGain(lfo.target, lfo.depth), t, 0.01)

  const shouldConnect = lfo.enabled && !lfoBypass
  if (shouldConnect) {
    if (lfoConnectedTo[slot - 1] !== lfo.target) {
      disconnectLfo(slot)
      connectLfoTo(slot, lfo.target)
    }
  } else {
    disconnectLfo(slot)
  }
}

function applyAllLfos() {
  applyLfoSlot(1)
  applyLfoSlot(2)
}

// requested 値 + sustainOverride から実 bypass を決める。
// sustainOverride=true の間はすべて false（フルチェーン）を返す。
function effectiveBypass(req: boolean): boolean {
  return sustainOverride ? false : req
}

// 各 bypass の「effective 値で audio graph を更新する」内部関数群。
// 公開 setter とは別に切り出してあるのは、setSustainOverride からも一括再適用する必要があるため。
function applyEnvelopeBypassEffective() {
  envelopeBypass = effectiveBypass(requestedEnvelopeBypass)
  // envelopeBypass は noteOn/noteOff 内で参照されるだけなので audio graph は触らない
}

function applyFilterBypassEffective() {
  const enabled = effectiveBypass(requestedFilterBypass)
  filterBypass = enabled
  if (!state || !currentPatch) return
  const t = state.ctx.currentTime
  if (enabled) {
    state.filter.type = 'lowpass'
    state.filter.Q.setTargetAtTime(0.0001, t, 0.01)
    state.filter.frequency.setTargetAtTime(RAW_FILTER_HZ, t, 0.01)
    resetFilterEnvelope(state.filterEnvDepth.gain, t)
  } else {
    state.filter.type = currentPatch.filter.type as BiquadFilterType
    state.filter.Q.setTargetAtTime(currentPatch.filter.q, t, 0.01)
    state.filter.frequency.setTargetAtTime(currentPatch.filter.cutoff, t, 0.01)
  }
}

function applyLfoBypassEffective() {
  lfoBypass = effectiveBypass(requestedLfoBypass)
  applyAllLfos()
}

function applyFxChainBypassEffective() {
  const enabled = effectiveBypass(requestedFxChainBypass)
  fxChainBypass = enabled
  if (!state) return
  const t = state.ctx.currentTime
  state.chainDry.gain.setTargetAtTime(enabled ? 1 : 0, t, 0.02)
  state.chainWet.gain.setTargetAtTime(enabled ? 0 : 1, t, 0.02)
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

  // LFO スロット 1 (常設、target に応じて connect/disconnect で行き先を切替)
  const lfoOsc = ctx.createOscillator()
  lfoOsc.type = 'sine'
  lfoOsc.frequency.value = 5
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 0
  lfoOsc.connect(lfoDepth)
  lfoOsc.start()

  // LFO スロット 2
  const lfoOsc2 = ctx.createOscillator()
  lfoOsc2.type = 'triangle'
  lfoOsc2.frequency.value = 3
  const lfoDepth2 = ctx.createGain()
  lfoDepth2.gain.value = 0
  lfoOsc2.connect(lfoDepth2)
  lfoOsc2.start()

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
    lfoOsc2, lfoDepth2,
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
    applyAllLfos()
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

  // 各 step useEffect が「ここでは X を bypass したい」と申告する。
  // sustainOverride=true の間は実効値は false で固定（ホールド演奏が止まらないように）。
  setEnvelopeBypass(enabled: boolean) {
    requestedEnvelopeBypass = enabled
    applyEnvelopeBypassEffective()
  },

  setFilterBypass(enabled: boolean) {
    requestedFilterBypass = enabled
    applyFilterBypassEffective()
  },

  setLfo(partial: Partial<LfoParams>) {
    if (!currentPatch) return
    currentPatch.lfo = { ...currentPatch.lfo, ...partial }
    applyLfoSlot(1)
  },

  setLfo2(partial: Partial<LfoParams>) {
    if (!currentPatch) return
    currentPatch.lfo2 = { ...currentPatch.lfo2, ...partial }
    applyLfoSlot(2)
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
    requestedFxChainBypass = enabled
    applyFxChainBypassEffective()
  },

  /**
   * ホールド演奏中フラグ。true にすると envelope/filter/lfo/fxChain の bypass 要求がすべて
   * false 扱いになり、step 遷移しても音が途切れない。false に戻すと requested 値が再適用される。
   */
  setSustainOverride(enabled: boolean) {
    sustainOverride = enabled
    applyEnvelopeBypassEffective()
    applyFilterBypassEffective()
    applyLfoBypassEffective()
    applyFxChainBypassEffective()
  },

  isSustainOverride(): boolean {
    return sustainOverride
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
    requestedLfoBypass = enabled
    applyLfoBypassEffective()
  },

  /**
   * patch 全体を現在の audio graph に反映（バンク読込時に使用）。
   * バイパス状態（envelope/filter/lfo/fxChain）は触らない — ページ側の責務。
   * 演奏中ノートは中断せず、各 param は setTargetAtTime で滑らかに更新する。
   */
  applyPatch(patch: SynthPatch) {
    currentPatch = patch
    if (!state) return
    const t = state.ctx.currentTime

    // 1. wavetable（worklet が phase 連続なので継ぎ目なく差し替え可能）
    AudioEngine.setWavetable(patch.wavetable)

    // 2. filter（バイパス中は触らない — バイパス解除時に復元される）
    if (!filterBypass) {
      state.filter.type = patch.filter.type as BiquadFilterType
      state.filter.Q.setTargetAtTime(Math.max(0.0001, Math.min(40, patch.filter.q)), t, 0.01)
      state.filter.frequency.setTargetAtTime(Math.max(20, Math.min(20000, patch.filter.cutoff)), t, 0.01)
    }

    // 3. フィルター ADSR: 無効 or バイパス中なら現在の寄与を 0 に戻す（次の noteOn で再評価）
    if (!patch.filterEnvelope.enabled || filterBypass) {
      resetFilterEnvelope(state.filterEnvDepth.gain, t)
    }

    // 4. LFO×2（applyLfoSlot は currentPatch を読むので 1 行目で更新済み）
    applyAllLfos()

    // 5. FX チェーン（順序 → 各エフェクトの params → enabled の順で反映）
    state.fxChain.setOrder(patch.fx.order)
    for (const id of Object.keys(patch.fx.fx) as FxId[]) {
      const fxState = patch.fx.fx[id]
      const node = state.fxNodes[id]
      for (const [k, v] of Object.entries(fxState.params)) node.setParam(k, v)
      node.setEnabled(fxState.enabled)
    }
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
