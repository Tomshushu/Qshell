export function PermissionBadge({ perm }: { perm?: string }) {
  if (!perm) return null
  const parts = perm.split('')
  const colors: Record<string, string> = {
    r: 'text-green-500',
    w: 'text-yellow-500',
    x: 'text-red-500',
    '-': 'text-muted-foreground/30',
  }
  return (
    <span className="font-mono text-xs">
      {parts.map((c, i) => (
        <span key={i} className={colors[c] || 'text-muted-foreground/30'}>
          {c}
        </span>
      ))}
    </span>
  )
}
