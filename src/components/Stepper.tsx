import type { StepId } from '../types'

type Props = {
  current: StepId
  onChange: (s: StepId) => void
}

const STEPS: { id: StepId; label: string }[] = [
  { id: 1, label: '波形' },
  { id: 2, label: '音の変化' },
  { id: 3, label: 'フィルター' },
  { id: 4, label: '演奏' },
]

export function Stepper({ current, onChange }: Props) {
  return (
    <nav className="flex flex-wrap items-center gap-2">
      {STEPS.map((s, idx) => {
        const active = s.id === current
        const done = s.id < current
        return (
          <div key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => onChange(s.id)}
              className={[
                'flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition',
                active
                  ? 'border-lab-accent bg-lab-accent text-white shadow'
                  : done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-lab-line bg-white text-lab-mute hover:bg-slate-50',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                  active ? 'bg-white text-lab-accent' : done ? 'bg-emerald-200' : 'bg-slate-200',
                ].join(' ')}
              >
                {s.id}
              </span>
              <span>{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && <span className="text-lab-line">→</span>}
          </div>
        )
      })}
    </nav>
  )
}
