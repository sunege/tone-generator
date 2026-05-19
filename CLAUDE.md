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

Built on Web Audio API. One AudioContext, one signal chain, shared across all four pages. Created lazily on first user gesture in `App.tsx` (`AudioEngine.start()`).

```
[AudioWorklet wavetable-processor]
        │
        ▼
   [GainNode envGain]            ← ADSR (or bypassed to fixed gain)
        │
        ▼
   [AnalyserNode analyserPre]    ← Step3 "filter前 FFT/Oscillo"
        │
        ▼
   [BiquadFilterNode (lowpass)]  ← Step3 cutoff slider (or bypassed to 20kHz)
        │
        ▼
   [AnalyserNode analyserPost]   ← all other FFT/Oscilloscope panels
        │
        ▼
   [GainNode master] → destination
```

- The wavetable processor (`public/worklet/wavetable-processor.js`) holds a `Float32Array(1024)` and does phase-accumulator playback with linear interpolation. It receives `{type: 'wavetable', data}` and `{type: 'frequency', value}` via `port.postMessage`.
- **The worklet file is intentionally in `public/`** (not `src/`) so Vite serves it as a static asset; it must be loadable via `audioWorklet.addModule('/worklet/wavetable-processor.js')`.
- AnalyserNodes provide both `getFloatFrequencyData` (for FFT panels) **and** `getFloatTimeDomainData` (for Oscilloscope). Each panel just calls the appropriate method on the same shared analyser.

### Bypass flags (envelopeBypass / filterBypass)

Each step page can independently bypass envelope and/or filter so users hear isolated effects. State lives in `AudioEngine.ts` as module-scoped flags:

- `envelopeBypass`: `noteOn` skips ADSR and ramps `envGain` to `RAW_GAIN (0.5)` in 5ms; `noteOff` ramps back to `SILENT` in 10ms.
- `filterBypass`: filter `frequency` is forced to 20kHz (effectively transparent); `setCutoff` still writes to the patch but does not touch the live node.

Pages sync their toggle state via `useEffect`:
```ts
useEffect(() => { AudioEngine.setEnvelopeBypass(!applyEnvelope) }, [applyEnvelope])
useEffect(() => { AudioEngine.setFilterBypass(!applyFilter) }, [applyFilter])
```

**Always reset both flags to `false` in the unmount cleanup** so they don't leak to other steps. Step defaults:
- Step1: both OFF by default (raw waveform sound)
- Step2: envelope ON, filter OFF
- Step3: envelope OFF, filter ON
- Step4: both ON

### Envelope (ADSR) gotchas — read before touching `src/audio/envelope.ts`

The release-during-attack and attack-while-decaying transitions are subtle. Two non-obvious rules baked into the current code:

1. **Don't call `setValueAtTime(gain.value, ctxTime)` after `cancelAndHoldAtTime`.** `AudioParam.value` returns the last *explicitly set* value, not the current automation value. Using it as an anchor overrides the correct held value with stale data — this manifests as silent releases (MIN→MIN ramp).
2. **`triggerAttack` must include a 2ms `linearRamp` down to MIN before the actual attack.** Without this, the very first attack after ADSR parameter changes (or after a long idle) starts from an indeterminate value in Chrome, because `cancelAndHoldAtTime` does not always anchor when there is no prior automation event.

The `holdAt()` helper centralizes the cancelAndHoldAtTime call with a fallback for old browsers.

### Oscilloscope sync (`src/components/Oscilloscope.tsx`)

Uses zero-crossing trigger (negative→positive) with sub-sample linear interpolation so the displayed wave appears stationary. **Horizontal window is fixed at 1 period of A3 (220Hz)** regardless of the playing pitch — this lets students visually compare wavelengths across notes (higher note = more cycles visible in the same window).

Reads current frequency via `useSynthStore.getState().currentFreq`. When `freq` is null or buffer peak is below `SILENCE_THRESHOLD (0.005)`, shows only a center line.

Pages must update `synthStore.currentFreq` when starting/stopping notes. **Do not clear `currentFreq` on note release** — keep it set so the oscilloscope can visualize the Release tail; silence detection handles fade-out automatically.

### State management

Zustand store (`src/store/synthStore.ts`) holds the canonical `SynthPatch` (wavetable + envelope + filter), plus UI state (`step`, `currentFreq`, `audioReady`). Setters update the store **and** push to `AudioEngine` synchronously (e.g., `setWavetable` also calls `AudioEngine.setWavetable`). This keeps the store and audio nodes in lock-step without a separate sync layer.

### Page structure

`App.tsx` switches between 4 pages by `step` value (no router):
- `Step1Waveform` — handwrite/formula/preset editor, oscilloscope + FFT
- `Step2Envelope` — SVG-drag ADSR editor with press-and-hold test note
- `Step3Filter` — cutoff slider, pre/post FFT and oscilloscope comparison
- `Step4Play` — SVG piano keyboard (mono, last-press-priority) + PC keyboard mapping

The `Keyboard.tsx` component implements monophonic last-note-priority via a `heldRef` stack. When a key is released but others remain held, it uses `AudioEngine.setFrequency()` (pitch-only, no re-attack) for legato behavior; only the last released note triggers `noteOff()`.

## Conventions

- **Bypass flags reset on unmount** is mandatory. Easy to forget; causes silent bugs in adjacent steps.
- Test playback uses **440Hz (A4)** everywhere — earlier code used 220Hz which is hard to hear for sine waves.
- Long-text labels in panel headers use `h-5 overflow-hidden truncate` + `shrink-0 whitespace-nowrap` to prevent layout shift when dynamic labels grow.
- Buttons that toggle between states (`▶ 再生` / `■ 停止`) use fixed `h-10 w-64` to keep the click target stable.
- Tailwind palette uses custom `lab-*` colors (defined in `tailwind.config.js`) for the "lab/experiment room" theme — prefer these over arbitrary hex.
