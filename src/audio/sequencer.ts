import type { SequencerState } from '../types'
import { SEQUENCER_MAX_STEPS } from '../types'
import { midiToFreq } from '../lib/noteUtils'
import { AudioEngine } from './AudioEngine'

/**
 * シンプルな setTimeout ベースのステップシーケンサー（アルペジエイター）。
 *
 * 教育用途のテンポ範囲（〜240 BPM at 1/32 = 31.25ms/step）なら setTimeout の
 * ジッタ（〜4ms）は許容範囲。サンプル正確スケジュールが必要なら lookahead scheduler
 * + AudioContext.currentTime に置き換える余地あり。
 *
 * 動作:
 *   - setRoot(midi) で「現在押されている鍵盤の MIDI」を伝える（last-press 優先）
 *   - 初回 setRoot で再生開始（step 0 から）
 *   - 既に再生中の root 変更は次のステップから反映（current note は鳴り続ける）
 *   - setRoot(null) で停止、step 0 にリセット
 *   - 各ステップで step.enabled なら noteOn → gate × stepDur 後に noteOff
 */
class StepSequencer {
  private config: SequencerState
  private rootMidi: number | null = null
  private currentStep: number = 0
  private isPlaying: boolean = false
  private stepTimerId: number | null = null
  private gateTimerId: number | null = null

  /** UI ハイライト更新用。step=-1 は停止中。 */
  onStepChange: ((step: number) => void) | null = null
  /** Oscilloscope の triggerFreq 更新用に、再生中の note の freq を通知。 */
  onNote: ((freq: number) => void) | null = null

  constructor(initial: SequencerState) {
    this.config = initial
  }

  setConfig(config: SequencerState) {
    this.config = config
  }

  setRoot(midi: number | null) {
    if (midi !== null) {
      const wasIdle = this.rootMidi === null
      this.rootMidi = midi
      if (wasIdle) {
        this.currentStep = 0
        this.startInternal()
      }
      // 既に再生中なら root 更新のみ（次のステップから新 root で発音）
    } else {
      this.rootMidi = null
      this.stopInternal()
    }
  }

  isActive(): boolean {
    return this.isPlaying
  }

  getCurrentStep(): number {
    return this.isPlaying ? this.currentStep : -1
  }

  /** 鍵盤を離さず停止だけしたいケース用（パターン編集中のテスト等）。今は未使用。 */
  forceStop() {
    this.rootMidi = null
    this.stopInternal()
  }

  private startInternal() {
    if (this.isPlaying) return
    this.isPlaying = true
    this.tick()
  }

  private stopInternal() {
    this.isPlaying = false
    if (this.stepTimerId !== null) {
      clearTimeout(this.stepTimerId)
      this.stepTimerId = null
    }
    if (this.gateTimerId !== null) {
      clearTimeout(this.gateTimerId)
      this.gateTimerId = null
    }
    AudioEngine.noteOff()
    this.currentStep = 0
    this.onStepChange?.(-1)
  }

  private tick = () => {
    if (!this.isPlaying || this.rootMidi === null) return

    const c = this.config
    const stepDurMs = Math.max(1, (60 / Math.max(1, c.bpm)) * (4 / Math.max(1, c.division)) * 1000)
    const gate = Math.max(0, Math.min(1, c.gate))
    const gateDurMs = stepDurMs * gate
    const length = Math.max(1, Math.min(SEQUENCER_MAX_STEPS, c.length))

    const step = c.steps[this.currentStep]
    if (step && step.enabled) {
      const noteMidi = this.rootMidi + step.semitones
      const freq = midiToFreq(noteMidi)
      AudioEngine.noteOn(freq)
      this.onNote?.(freq)
      if (this.gateTimerId !== null) clearTimeout(this.gateTimerId)
      // gate < 1 のときだけ明示的に noteOff（gate=1 は次の noteOn がレガートで上書き）
      if (gate < 1) {
        this.gateTimerId = window.setTimeout(() => {
          if (this.isPlaying) AudioEngine.noteOff()
          this.gateTimerId = null
        }, gateDurMs)
      }
    }

    this.onStepChange?.(this.currentStep)

    // 進める
    this.currentStep = (this.currentStep + 1) % length
    this.stepTimerId = window.setTimeout(this.tick, stepDurMs)
  }
}

// 初期パターン（root から major 6 + octave のメジャー上昇形）
function defaultSteps(): SequencerState['steps'] {
  const pattern = [0, 4, 7, 12]
  return Array.from({ length: SEQUENCER_MAX_STEPS }, (_, i) => ({
    enabled: true,
    semitones: pattern[i % pattern.length] + Math.floor(i / pattern.length) * 0,
  }))
}

export const DEFAULT_SEQUENCER_STATE: SequencerState = {
  bpm: 120,
  division: 16,
  length: 16,
  gate: 0.5,
  steps: defaultSteps(),
}

export const Sequencer = new StepSequencer(DEFAULT_SEQUENCER_STATE)
