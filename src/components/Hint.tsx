type Props = {
  children: React.ReactNode
}

export function Hint({ children }: Props) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="mr-2 font-bold text-amber-700">💡 ヒント</span>
      {children}
    </div>
  )
}

type HintListProps = {
  items: string[]
}

export function HintList({ items }: HintListProps) {
  return (
    <Hint>
      <ul className="mt-1 list-inside list-disc space-y-1">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </Hint>
  )
}
