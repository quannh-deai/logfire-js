export const LEVEL_LABELS: Record<number, string> = {
  1: 'trace',
  5: 'debug',
  9: 'info',
  10: 'notice',
  13: 'warning',
  17: 'error',
  21: 'fatal',
}

export const LEVEL_OPTIONS = [
  { value: '', label: 'Any level' },
  { value: '1', label: '>= trace' },
  { value: '5', label: '>= debug' },
  { value: '9', label: '>= info' },
  { value: '13', label: '>= warning' },
  { value: '17', label: '>= error' },
]

export function levelLabel(num: number | null | undefined): string {
  if (num == null) return ''
  return LEVEL_LABELS[num] ?? `lvl${num}`
}

export function levelClass(num: number | null | undefined): string {
  if (num == null) return ''
  const label = LEVEL_LABELS[num]
  return label ? `level level-${label}` : 'level'
}
