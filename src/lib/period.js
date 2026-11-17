import { toISO, fromISO, today, addDays, monthName, shortDate, ddmm } from './format.js'

// Un período: { kind: 'day'|'week'|'month'|'year'|'custom', anchor: ISO, from?, to? }
export function range(p) {
  const d = fromISO(p.anchor)
  switch (p.kind) {
    case 'day': return [p.anchor, p.anchor]
    case 'week': {
      const dow = (d.getDay() + 6) % 7 // lunes = 0
      const from = addDays(p.anchor, -dow)
      return [from, addDays(from, 6)]
    }
    case 'month': return [toISO(new Date(d.getFullYear(), d.getMonth(), 1)), toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))]
    case 'year': return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`]
    case 'custom': return [p.from, p.to]
    default: return ['0000-01-01', '9999-12-31']
  }
}

export function shift(p, n) {
  const d = fromISO(p.anchor)
  switch (p.kind) {
    case 'day': return { ...p, anchor: addDays(p.anchor, n) }
    case 'week': return { ...p, anchor: addDays(p.anchor, 7 * n) }
    case 'month': return { ...p, anchor: toISO(new Date(d.getFullYear(), d.getMonth() + n, 1)) }
    case 'year': return { ...p, anchor: toISO(new Date(d.getFullYear() + n, 0, 1)) }
    case 'custom': {
      const len = Math.round((fromISO(p.to) - fromISO(p.from)) / 86400000) + 1
      return { ...p, from: addDays(p.from, len * n), to: addDays(p.to, len * n) }
    }
    default: return p
  }
}

export function label(p) {
  const d = fromISO(p.anchor)
  const y = new Date().getFullYear()
  switch (p.kind) {
    case 'day': {
      const t = today()
      if (p.anchor === t) return 'Hoy'
      if (p.anchor === addDays(t, -1)) return 'Ayer'
      return shortDate(p.anchor) + (d.getFullYear() !== y ? ` ${d.getFullYear()}` : '')
    }
    case 'week': { const [a, b] = range(p); return `${shortDate(a)} – ${shortDate(b)}` }
    case 'month': { const m = monthName(d.getMonth()); return m[0].toUpperCase() + m.slice(1) + (d.getFullYear() !== y ? ` ${d.getFullYear()}` : '') }
    case 'year': return String(d.getFullYear())
    case 'custom': return `${ddmm(p.from)} – ${ddmm(p.to)}`
    default: return ''
  }
}

export const inRange = (iso, [a, b]) => iso >= a && iso <= b
export const defaultPeriod = () => ({ kind: 'month', anchor: today() })
