type Item = {
  key: string
  label: string
  description?: string
}

type Props = {
  title: string
  items: Item[]
  onPick: (key: string) => void
  activeKey?: string
}

export function PresetSelector({ title, items, onPick, activeKey }: Props) {
  return (
    <div className="rounded-lg border border-lab-line bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-lab-mute">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it) => {
          const active = activeKey === it.key
          return (
            <button
              key={it.key}
              onClick={() => onPick(it.key)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                active
                  ? 'border-lab-accent bg-sky-50 text-lab-accent'
                  : 'border-lab-line hover:border-lab-accent hover:bg-slate-50'
              }`}
            >
              <div className="font-medium">{it.label}</div>
              {it.description && <div className="mt-0.5 text-xs text-lab-mute">{it.description}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
