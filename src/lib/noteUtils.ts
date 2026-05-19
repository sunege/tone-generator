export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToName(midi: number): string {
  const name = NOTE_NAMES[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

const SOLFEGE_BY_PC: Record<number, string> = {
  0: 'ド',
  2: 'レ',
  4: 'ミ',
  5: 'ファ',
  7: 'ソ',
  9: 'ラ',
  11: 'シ',
}

export function midiToSolfege(midi: number): string | null {
  return SOLFEGE_BY_PC[midi % 12] ?? null
}

export function isBlackKey(midi: number): boolean {
  const n = midi % 12
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10
}

// PC keyboard mapping (starting from C4 = MIDI 60)
// a w s e d f t g y h u j k
export const KEY_TO_MIDI_OFFSET: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
  "'": 17,
}
