# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web-based audio learning tool ("音色学習Webシミュレータ") for Japanese high-school physics. Detailed product requirements live in `要件.md` (Japanese). Default UI text and code comments are in Japanese — keep that style when extending.

## Commands

```bash
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # tsc -b (typecheck) + vite build → dist/
npm run typecheck  # tsc -b --noEmit
npm run preview    # serve dist/ for local production check
```

There is no test suite. Verify changes by running `npm run build` (typecheck is included) and by exercising each step in the browser.

## Architecture

### Audio pipeline (single mono voice)

Built on Web Audio API. One AudioContext, one signal chain, shared across all seven pages. Created lazily on first user gesture in `App.tsx` (`AudioEngine.start()`).

```
[AudioWorklet wavetable-processor]        ← exposes 'detune' AudioParam (cents)
        │
        ▼
   [GainNode envGain]                     ← amplitude ADSR (or bypassed to RAW_GAIN)
        │
        ▼
   [GainNode lfoAmpGain]                  ← LFO sum bus for target=amp (base 1.0)
        │
        ▼
   [AnalyserNode analyserPre]             ← Step3 "filter前 FFT/Oscillo"
        │
        ▼
   [BiquadFilterNode]                     ← Step3/5: type/cutoff/Q (or bypassed to lowpass 20kHz)
        │  ⇐ additive: filter ADSR (ConstantSource → filterEnvDepth → filter.frequency)
        │  ⇐ additive: LFO depth (target=filter)
        ▼
   [AnalyserNode analyserPost]            ← most FFT/Oscilloscope panels
        │
        ▼
   [GainNode master]
        │
        ├──► [GainNode chainDry] ──────────────────────►┐
        │                                                │
        └──► [FxChain (6 effects, dynamic order)]       │
              └──► [GainNode chainWet] ─────────────────►┤
                                                         │
                                            [AnalyserNode analyserOut]  ← Step6 post-FX FFT/Oscillo
                                                         │
                                                         ▼
                                                 ctx.destination
```

- **Two AudioWorklets**, both in `public/worklet/` (served as static assets by Vite, loaded via `audioWorklet.addModule('/worklet/<name>.js')`):
  - `wavetable-processor.js` — `Float32Array(1024)` phase accumulator with linear interpolation; AudioParam `detune` (cents) is the modulation entry point used by LFO target=pitch and `setPitchBend()`.
  - `bitcrusher-processor.js` — `bits` + `downsample` AudioParams (quantization + sample-and-hold).
- **LFO × 2**: Two `OscillatorNode + GainNode` pairs (`lfoOsc/lfoDepth`, `lfoOsc2/lfoDepth2`). Each slot dynamically `connect/disconnect`s to one of three destinations (`lfoAmpGain.gain`, `filter.frequency`, worklet `detune`). Both slots may target the same destination; signals sum additively. The currently connected target per slot is tracked in `lfoConnectedTo: (LfoTarget | null)[]` so disconnect is correct.
- **Filter envelope**: `ConstantSource(1)` → `filterEnvDepth.gain` (driven by an ADSR) → `filter.frequency`. Additive with the base cutoff and any LFO targeting filter — both modulators stack naturally.
- **FX chain** (`src/audio/fx.ts`): 6 effects (delay, reverb, chorus, phaser, distortion, bitcrusher) wired serially. `master` splits into `chainDry` (always-on bypass tap) and the FX chain → `chainWet`; both sum into `analyserOut`. `setFxChainBypass()` crossfades dry↔wet (`dry=1,wet=0` when bypassed).
- AnalyserNodes provide both `getFloatFrequencyData` (FFT panels) **and** `getFloatTimeDomainData` (Oscilloscope). Each panel just calls the appropriate method on the same shared analyser.

### Bypass flags (envelope / filter / lfo / fxChain)

Each step page bypasses subsystems it doesn't teach so users hear isolated effects. Module-scoped flags in `AudioEngine.ts`:

- `envelopeBypass`: `noteOn` skips ADSR and ramps `envGain` to `RAW_GAIN (0.5)` in 5ms; `noteOff` ramps back to `SILENT` in 10ms.
- `filterBypass`: filter forced to lowpass 20kHz / Q≈0; `setFilterType/Q/Cutoff` still write `currentPatch` but don't touch the live node. Filter envelope contribution is reset to 0 too.
- `lfoBypass`: both LFO slots disconnected from their targets (the per-slot apply function reads this flag).
- `fxChainBypass`: dry/wet crossfade as above.

Pages sync toggle state via `useEffect` (example):
```ts
useEffect(() => { AudioEngine.setEnvelopeBypass(!applyEnvelope) }, [applyEnvelope])
```

**Always reset bypass flags in unmount cleanup** so they don't leak to other steps. Approximate defaults per step (consult each page's `useEffect` for the exact pattern):

| step | env | filter | lfo | fx |
|------|-----|--------|-----|-----|
| 1 波形 | bypass | bypass | bypass | bypass |
| 2 音の変化 | apply | bypass | bypass | bypass |
| 3 フィルター | bypass | apply | bypass | bypass |
| 4 演奏 | apply | apply | bypass | bypass |
| 5 アドバンスド | apply | apply | apply | bypass |
| 6 エフェクター | apply | apply | apply | apply |
| 7 シーケンサー | apply | apply | apply | apply |

(Step 5 also drives the filter envelope and pitch-bend slider; Step 6 is the only place the FX chain is audible; Step 7 runs the sequencer with everything live.)

### Envelope (ADSR) gotchas — applies to `src/audio/envelope.ts` and `src/audio/filterEnvelope.ts`

Both ADSR modules share the same pattern. Chrome's `cancelAndHoldAtTime` does **not** anchor reliably when no prior automation event exists, and `AudioParam.value` returns the last *explicitly set* value (not the current automation value). Three non-obvious rules baked in:

1. **Don't use `gain.value` after `cancelAndHoldAtTime`.** It returns stale data and produces silent ramps (manifests as no audible release, "プツッ" click). Instead, both `envelope.ts` and `filterEnvelope.ts` track attack info in a module-level variable (`lastAttack`) and **compute the current envelope value in JS**, then write it with `setValueAtTime` before the ramp. `triggerRelease` always anchors from the JS-computed value, not from `gain.value`.
2. **`triggerAttack` includes a 2ms `linearRamp` down to MIN before the actual attack** to handle the indeterminate-value case after long idles or ADSR-parameter changes. `filterEnvelope.ts` uses `FE_QUICK_RESET = 0.002` for the same reason.
3. **Sustain-phase release must re-anchor**: when the user releases a held key after reaching sustain, the JS state knows the sustain value — write it explicitly before the release ramp. Relying on `cancelAndHoldAtTime` alone produces a silent release.

`envelope.ts` provides a `holdAt()` helper that centralises the cancelAndHoldAtTime call with a fallback for old browsers.

### Oscilloscope sync (`src/components/Oscilloscope.tsx`)

Uses zero-crossing trigger (negative→positive) with sub-sample linear interpolation so the displayed wave appears stationary. **Horizontal window is fixed at 1 period of A3 (220Hz)** regardless of the playing pitch — this lets students visually compare wavelengths across notes (higher note = more cycles visible in the same window).

`SILENCE_THRESHOLD = 0.0005` (-66 dB) and the component caches the last-known trigger frequency in `lastFreqRef`. This lets the scope keep drawing during:
- Long Release tails (note has been released but envelope is still decaying)
- Delay / Reverb echoes (signal continues after the dry note ends)

Pages update `synthStore.currentFreq` when starting notes. **Do not clear `currentFreq` on note release** — silence detection + `lastFreqRef` handle fade-out automatically. When the signal drops below threshold and no current freq exists, the scope shows only a center line.

### State management

Zustand store (`src/store/synthStore.ts`) holds:

- **`patch: SynthPatch`** — wavetable + envelope + filter + filterEnvelope + lfo + lfo2 + fx + sequencer
- **UI state** — `step`, `currentFreq`, `audioReady`, `activePresetKey`, `activeEnvelopePresetKey`, `waveEditorMode`, `waveEditorFormula`
- **Bank state** — `banks`, `activeToneBank`, `activeSeqBank` (see [Bank feature](#bank-feature))

Granular setters update the store **and** push to `AudioEngine` synchronously (e.g., `setWavetable` also calls `AudioEngine.setWavetable`). Bulk patch updates (bank load, reset) go through `AudioEngine.applyPatch(patch)` which atomically reapplies wavetable / filter / filter-envelope / both LFOs / FX chain while respecting current bypass flags. The initial patch is built via `makeInitialPatch()` so the reset action returns fresh object instances (not aliased to the boot-time patch).

### Bank feature (`src/lib/banks.ts`, `src/components/BankBar.tsx`)

5 tone banks + 5 sequencer banks, persisted to `localStorage` under the versioned key `tone-generator:banks:v2` (bump both `STORAGE_KEY` and `SCHEMA_VERSION` together when the bank format changes — older saves are simply discarded).

- **Click cell** = load; **long-press 700 ms** = save (progress fill animation in the cell).
- **Keyboard `1`-`5`** = load tone bank; **`Shift+1`-`5`** = load sequencer bank. Handler in `App.tsx` skips digit keys when an input/textarea has focus, so number entry in sliders/formula isn't hijacked.
- **Bank 1 ships with demo content** (ピアノ音色 / メジャースケール上昇). Banks 2–5 carry additional demos (clarinet, bell, lead, 8-bit / arpeggio variants).
- **`⟲ デフォルト` button** in `BankBar` calls `resetPatch()` (with a `confirm()` dialog) which restores `makeInitialPatch()` and clears `activeToneBank`/`activeSeqBank` markers. Bank contents are preserved.
- **JSON export/import** (`exportBanksAsJson` / `importBanksFromJson`): single file holds both bank kinds; `SCHEMA_VERSION` is checked on import. `Float32Array` (wavetable) is converted to `number[]` only at the JSON boundary.
- Tone banks contain everything **except** `sequencer`; sequencer is its own bank kind so phrases and sounds can be A/B-tested independently.

`loadToneBank` calls `AudioEngine.applyPatch`; `loadSeqBank` calls `Sequencer.setConfig`. Both are seamless mid-note (worklet phase is continuous) and mid-sequence (the scheduler reads config on each tick).

### Page structure

`App.tsx` switches between 7 pages by `step` value (no router). Arrow keys (←/→) navigate steps; digit keys (1-5, Shift+1-5) trigger bank loads — both skip when an input is focused.

- `Step1Waveform` — handwrite / formula / preset editor, oscilloscope + FFT
- `Step2Envelope` — SVG-drag ADSR editor with press-and-hold test note
- `Step3Filter` — cutoff slider, pre/post FFT and oscilloscope comparison
- `Step4Play` — SVG piano (mono, last-press-priority) + PC keyboard mapping
- `Step5Advanced` — filter type/Q, filter envelope (ADSR + bipolar depth), LFO × 2 (target ∈ amp/filter/pitch), pitch bend slider
- `Step6Effects` — 6 FX with per-effect params, reorderable serial chain, post-FX scope
- `Step7Sequencer` — 32-step arpeggiator (BPM / division / length / gate / per-step ±semitones), monophonic root from keyboard

The `Keyboard.tsx` component implements monophonic last-note-priority via a `heldRef` stack. When a key is released but others remain held, it uses `AudioEngine.setFrequency()` (pitch-only, no re-attack) for legato. It accepts an optional `onRootChange?: (midi | null) => void` prop — when provided (Step7), it overrides direct AudioEngine calls so the sequencer can take over note triggering.

### Step sequencer (`src/audio/sequencer.ts`)

`setTimeout`-based scheduler running at `bpm × division` cadence. Acceptable jitter (~4 ms) for educational tempos. Public API:

- `setRoot(midi)` from the keyboard starts playback at step 0; `setRoot(null)` stops and resets.
- The current note is held for `gate × stepDur`; `gate === 1` means legato (no explicit noteOff — the next noteOn overlaps).
- Pattern edits via `setSeqStep` push updates synchronously; the next tick sees the new pattern.
- `setConfig(state)` swaps the entire `SequencerState` atomically (used by bank loads and by Step7 control changes).

## Conventions

- **Bypass flags reset on unmount** is mandatory. Easy to forget; causes silent bugs in adjacent steps.
- Test playback uses **440 Hz (A4)** everywhere — earlier code used 220 Hz which is hard to hear for sine waves.
- Long-text labels in panel headers use `h-5 overflow-hidden truncate` + `shrink-0 whitespace-nowrap` to prevent layout shift when dynamic labels grow.
- Buttons that toggle between states (`▶ 再生` / `■ 停止`) use fixed `h-10 w-64` to keep the click target stable.
- Tailwind palette uses custom `lab-*` colors (defined in `tailwind.config.js`) for the "lab/experiment room" theme — prefer these over arbitrary hex.
- Bank save uses **long-press** (not click) to avoid accidental overwrites; loading is a single click for snappy A/B comparison.
- When adding a new patch field: update `makeInitialPatch()` in `synthStore.ts`, the demo banks in `banks.ts`, and `AudioEngine.applyPatch()` if the field is audio-bound. The bank serializer handles structural JSON via spread — only `Float32Array` (wavetable) needs special conversion.
