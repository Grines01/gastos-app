// Tarjetas de crédito: día de cierre y de vencimiento, fechas de las cuotas y recordatorios.
// Una tarjeta: { id, name, closeDay: 1–31, dueDay: 1–31 }
// Si el mes no tiene ese día (31 en febrero), se usa el último día del mes.

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}` // m: 0–11
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate()
const parts = (s) => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d] }
export const dayIn = (y, m, day) => { const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return iso(yy, mm, Math.min(day, lastDay(yy, mm))) }
export const daysBetween = (a, b) => Math.round((Date.UTC(...parts(b)) - Date.UTC(...parts(a))) / 86400000)

// primer cierre en o después de la fecha
export function closeOnOrAfter(date, closeDay) {
  const [y, m] = parts(date)
  const c = dayIn(y, m, closeDay)
  return c >= date ? c : dayIn(y, m + 1, closeDay)
}
// primer vencimiento después de un cierre
export function dueAfterClose(close, dueDay) {
  const [y, m] = parts(close)
  const d = dayIn(y, m, dueDay)
  return d > close ? d : dayIn(y, m + 1, dueDay)
}
// primer vencimiento en o después de la fecha
export function dueOnOrAfter(date, dueDay) {
  const [y, m] = parts(date)
  const d = dayIn(y, m, dueDay)
  return d >= date ? d : dayIn(y, m + 1, dueDay)
}

// Fechas en que se paga cada cuota: el vencimiento del resumen que la incluye.
// Sin tarjeta: el mismo día de la compra, un mes después de otro.
export function installmentDates(purchase, n, card) {
  const [y, m, d] = parts(purchase)
  if (!card) return Array.from({ length: n }, (_, k) => dayIn(y, m + k, d))
  const [cy, cm] = parts(closeOnOrAfter(purchase, card.closeDay))
  return Array.from({ length: n }, (_, k) => dueAfterClose(dayIn(cy, cm + k, card.closeDay), card.dueDay))
}

// Reparte un total (centavos) en n cuotas; la última absorbe el redondeo
export function splitAmount(total, n) {
  const each = Math.floor(total / n)
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? total - each * (n - 1) : each))
}

// Próximo cierre y vencimiento de cada tarjeta desde `from`
export function nextDates(card, from) {
  return { close: closeOnOrAfter(from, card.closeDay), due: dueOnOrAfter(from, card.dueDay) }
}

// Eventos dentro de los próximos `days` días (0 = hoy)
export function reminders(cards, today, days = 2) {
  const out = []
  for (const c of cards) {
    const { close, due } = nextDates(c, today)
    for (const [kind, date] of [['cierre', close], ['vencimiento', due]]) {
      const inDays = daysBetween(today, date)
      if (inDays >= 0 && inDays <= days) out.push({ card: c, kind, date, inDays })
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays)
}

export const whenText = (n) => (n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`)
