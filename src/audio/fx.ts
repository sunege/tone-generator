import type { FxId } from '../types'

/**
 * 各エフェクトの共通インターフェース。
 * input/output は外部から接続するための GainNode。内部で dry+wet を合成して output に書く。
 *
 * 各エフェクトの内部経路:
 *   input → dryGain ─────────────────────→ output
 *   input → (effect nodes) → wetGain ────→ output
 *
 * enabled が false のとき wetGain=0 にして実質ドライのみ通過。
 * 効果ノードは常に動いているので CPU は使うが、ON/OFF 時の音切れは最小化される。
 */
export type FxNode = {
  id: FxId
  input: GainNode
  output: GainNode
  setEnabled(enabled: boolean): void
  setParam(name: string, value: number): void
  dispose(): void
}

const RAMP = 0.01  // パラメータの設定 ramp（秒）

// ───────────────────────────────────────────────────────── Delay
function createDelay(ctx: AudioContext, initial: Record<string, number>): FxNode {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0
  const delay = ctx.createDelay(2.0)
  const feedback = ctx.createGain()

  delay.delayTime.value = initial.time ?? 0.35
  feedback.gain.value = initial.feedback ?? 0.4

  input.connect(dry).connect(output)
  input.connect(delay)
  delay.connect(feedback).connect(delay)  // フィードバックループ
  delay.connect(wet).connect(output)

  let enabled = false
  let wetUser = initial.wet ?? 0.35

  function applyWet() {
    wet.gain.setTargetAtTime(enabled ? wetUser : 0, ctx.currentTime, RAMP)
  }

  return {
    id: 'delay',
    input, output,
    setEnabled(v) { enabled = v; applyWet() },
    setParam(name, value) {
      const t = ctx.currentTime
      if (name === 'time') delay.delayTime.setTargetAtTime(value, t, RAMP)
      else if (name === 'feedback') feedback.gain.setTargetAtTime(Math.min(0.95, value), t, RAMP)
      else if (name === 'wet') { wetUser = value; applyWet() }
    },
    dispose() {
      try { input.disconnect() } catch { /* */ }
      try { delay.disconnect() } catch { /* */ }
      try { feedback.disconnect() } catch { /* */ }
    },
  }
}

// ───────────────────────────────────────────────────────── Reverb (合成 IR)
function createReverb(ctx: AudioContext, initial: Record<string, number>): FxNode {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0
  const convolver = ctx.createConvolver()

  let currentDecay = initial.decay ?? 2.5
  let enabled = false
  let wetUser = initial.wet ?? 0.3

  function buildIR(decay: number) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * Math.min(5, decay)))
    const ir = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        // 指数的減衰したホワイトノイズ。decay 秒で約 1/1000 まで減衰
        const env = Math.pow(1 - i / length, 2)
        data[i] = (Math.random() * 2 - 1) * env
      }
    }
    convolver.buffer = ir
  }
  buildIR(currentDecay)

  input.connect(dry).connect(output)
  input.connect(convolver)
  convolver.connect(wet).connect(output)

  function applyWet() {
    wet.gain.setTargetAtTime(enabled ? wetUser : 0, ctx.currentTime, RAMP)
  }

  return {
    id: 'reverb',
    input, output,
    setEnabled(v) { enabled = v; applyWet() },
    setParam(name, value) {
      if (name === 'decay') {
        currentDecay = value
        buildIR(currentDecay)
      } else if (name === 'wet') {
        wetUser = value; applyWet()
      }
    },
    dispose() {
      try { input.disconnect() } catch { /* */ }
      try { convolver.disconnect() } catch { /* */ }
    },
  }
}

// ───────────────────────────────────────────────────────── Chorus
function createChorus(ctx: AudioContext, initial: Record<string, number>): FxNode {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0

  const delay = ctx.createDelay(0.05)
  delay.delayTime.value = 0.020  // 20ms ベース

  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = initial.rate ?? 1.2
  const lfoDepth = ctx.createGain()
  // depth 0..1 を ±depth*0.008 秒（±8ms）にスケール
  lfoDepth.gain.value = (initial.depth ?? 0.5) * 0.008
  lfo.connect(lfoDepth).connect(delay.delayTime)
  lfo.start()

  input.connect(dry).connect(output)
  input.connect(delay).connect(wet).connect(output)

  let enabled = false
  let wetUser = initial.wet ?? 0.5

  function applyWet() {
    wet.gain.setTargetAtTime(enabled ? wetUser : 0, ctx.currentTime, RAMP)
  }

  return {
    id: 'chorus',
    input, output,
    setEnabled(v) { enabled = v; applyWet() },
    setParam(name, value) {
      const t = ctx.currentTime
      if (name === 'rate') lfo.frequency.setTargetAtTime(value, t, RAMP)
      else if (name === 'depth') lfoDepth.gain.setTargetAtTime(value * 0.008, t, RAMP)
      else if (name === 'wet') { wetUser = value; applyWet() }
    },
    dispose() {
      try { lfo.stop() } catch { /* */ }
      try { input.disconnect() } catch { /* */ }
      try { delay.disconnect() } catch { /* */ }
    },
  }
}

// ───────────────────────────────────────────────────────── Phaser (4 段 allpass)
function createPhaser(ctx: AudioContext, initial: Record<string, number>): FxNode {
  const STAGES = 4
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0

  const allpasses: BiquadFilterNode[] = []
  for (let i = 0; i < STAGES; i++) {
    const ap = ctx.createBiquadFilter()
    ap.type = 'allpass'
    // 段ごとに少しずつ違う中心周波数（より複雑な notch パターン）
    ap.frequency.value = 400 + i * 300
    ap.Q.value = 1.5
    allpasses.push(ap)
  }

  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = initial.rate ?? 0.4
  const lfoDepth = ctx.createGain()
  // depth 0..1 → ±1500 Hz sweep
  lfoDepth.gain.value = (initial.depth ?? 0.7) * 1500
  allpasses.forEach((ap) => lfoDepth.connect(ap.frequency))
  lfo.connect(lfoDepth)
  lfo.start()

  const feedback = ctx.createGain()
  feedback.gain.value = initial.feedback ?? 0.5

  // 直列接続: input → ap1 → ap2 → ap3 → ap4 → wet → output
  input.connect(allpasses[0])
  for (let i = 0; i < STAGES - 1; i++) allpasses[i].connect(allpasses[i + 1])
  allpasses[STAGES - 1].connect(wet).connect(output)
  // フィードバック: 最後の allpass → feedback → 最初の allpass
  allpasses[STAGES - 1].connect(feedback).connect(allpasses[0])

  input.connect(dry).connect(output)

  let enabled = false
  let wetUser = initial.wet ?? 0.5

  function applyWet() {
    wet.gain.setTargetAtTime(enabled ? wetUser : 0, ctx.currentTime, RAMP)
  }

  return {
    id: 'phaser',
    input, output,
    setEnabled(v) { enabled = v; applyWet() },
    setParam(name, value) {
      const t = ctx.currentTime
      if (name === 'rate') lfo.frequency.setTargetAtTime(value, t, RAMP)
      else if (name === 'depth') lfoDepth.gain.setTargetAtTime(value * 1500, t, RAMP)
      else if (name === 'feedback') feedback.gain.setTargetAtTime(Math.min(0.9, value), t, RAMP)
      else if (name === 'wet') { wetUser = value; applyWet() }
    },
    dispose() {
      try { lfo.stop() } catch { /* */ }
      try { input.disconnect() } catch { /* */ }
      allpasses.forEach((ap) => { try { ap.disconnect() } catch { /* */ } })
    },
  }
}

// ───────────────────────────────────────────────────────── Distortion (WaveShaper + tone)
function createDistortion(ctx: AudioContext, initial: Record<string, number>): FxNode {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0
  const shaper = ctx.createWaveShaper()
  shaper.oversample = '4x'
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = initial.tone ?? 3000
  tone.Q.value = 0.7
  // 歪んだ後で音量が暴れがちなので最終ゲインで下げる
  const trim = ctx.createGain()
  trim.gain.value = 0.6

  function buildCurve(drive: number) {
    const samples = 4096
    const curve = new Float32Array(samples)
    const k = Math.max(1, drive)
    const norm = Math.tanh(k)
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1
      curve[i] = Math.tanh(k * x) / norm
    }
    shaper.curve = curve
  }
  buildCurve(initial.drive ?? 20)

  input.connect(dry).connect(output)
  input.connect(shaper).connect(tone).connect(trim).connect(wet).connect(output)

  let enabled = false
  let wetUser = initial.wet ?? 0.5

  function applyWet() {
    wet.gain.setTargetAtTime(enabled ? wetUser : 0, ctx.currentTime, RAMP)
  }

  return {
    id: 'distortion',
    input, output,
    setEnabled(v) { enabled = v; applyWet() },
    setParam(name, value) {
      if (name === 'drive') buildCurve(value)
      else if (name === 'tone') tone.frequency.setTargetAtTime(value, ctx.currentTime, RAMP)
      else if (name === 'wet') { wetUser = value; applyWet() }
    },
    dispose() {
      try { input.disconnect() } catch { /* */ }
      try { shaper.disconnect() } catch { /* */ }
    },
  }
}

// ───────────────────────────────────────────────────────── Bitcrusher (worklet)
function createBitcrusher(ctx: AudioContext, initial: Record<string, number>): FxNode {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0

  const crusher = new AudioWorkletNode(ctx, 'bitcrusher-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  })
  const bitsParam = crusher.parameters.get('bits')!
  const dsParam = crusher.parameters.get('downsample')!
  bitsParam.value = initial.bits ?? 6
  dsParam.value = initial.downsample ?? 4

  input.connect(dry).connect(output)
  input.connect(crusher).connect(wet).connect(output)

  let enabled = false
  let wetUser = initial.wet ?? 0.5

  function applyWet() {
    wet.gain.setTargetAtTime(enabled ? wetUser : 0, ctx.currentTime, RAMP)
  }

  return {
    id: 'bitcrusher',
    input, output,
    setEnabled(v) { enabled = v; applyWet() },
    setParam(name, value) {
      const t = ctx.currentTime
      if (name === 'bits') bitsParam.setTargetAtTime(value, t, RAMP)
      else if (name === 'downsample') dsParam.setTargetAtTime(value, t, RAMP)
      else if (name === 'wet') { wetUser = value; applyWet() }
    },
    dispose() {
      try { input.disconnect() } catch { /* */ }
      try { crusher.disconnect() } catch { /* */ }
    },
  }
}

export type FxFactoryInit = Partial<Record<FxId, Record<string, number>>>

export function createAllEffects(ctx: AudioContext, init: FxFactoryInit): Record<FxId, FxNode> {
  return {
    delay: createDelay(ctx, init.delay ?? {}),
    reverb: createReverb(ctx, init.reverb ?? {}),
    chorus: createChorus(ctx, init.chorus ?? {}),
    phaser: createPhaser(ctx, init.phaser ?? {}),
    distortion: createDistortion(ctx, init.distortion ?? {}),
    bitcrusher: createBitcrusher(ctx, init.bitcrusher ?? {}),
  }
}

/**
 * チェーン管理。order を変えると input → fx1 → fx2 → ... → output と繋ぎ直す。
 * 並び替え時のグリッチは setTargetAtTime のランプで多少緩和されるが、無音化はしていない。
 */
export class FxChain {
  ctx: AudioContext
  input: GainNode
  output: GainNode
  effects: Record<FxId, FxNode>
  order: FxId[]

  constructor(ctx: AudioContext, effects: Record<FxId, FxNode>, initialOrder: FxId[]) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.effects = effects
    this.order = [...initialOrder]
    this.rewire()
  }

  setOrder(order: FxId[]) {
    this.order = [...order]
    this.rewire()
  }

  private rewire() {
    // 全ノードを disconnect してから繋ぎ直す
    try { this.input.disconnect() } catch { /* */ }
    for (const id of Object.keys(this.effects) as FxId[]) {
      try { this.effects[id].output.disconnect() } catch { /* */ }
    }
    let prev: AudioNode = this.input
    for (const id of this.order) {
      const fx = this.effects[id]
      if (!fx) continue
      prev.connect(fx.input)
      prev = fx.output
    }
    prev.connect(this.output)
  }
}
