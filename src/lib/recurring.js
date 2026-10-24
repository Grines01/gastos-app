// Pagos recurrentes automáticos (suscripciones y débitos automáticos).
// No se cargan solos: se proyectan, y cuando el pago real aparece (lo cargás o lo importás) cuentan como pagados.
//
// Un recurrente: { id, name, key, amount, currency: 'ARS'|'USD', origAmount?, categoryId, freq: 'monthly'|'yearly',
//                  day: 1–31, month?: 1–12 (si es anual), method: 'card'|'account', cardId?, start: 'YYYY-MM' }
//   amount: centavos de pesos (si es en USD, origAmount son centavos de dólar y amount se calcula con la cotización)
//   key:    palabra que identifica el cobro en tus movimientos ("claude", "audible", "personal")

const pad = (n) => String(n).padStart(2, '0')
const lastDay = (y, m) => new Date(y, m, 0).getDate() // m: 1–12
export const dateIn = (y, m, day) => { const yy = y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12 + 1; return `${yy}-${pad(mm)}-${pad(Math.min(day, lastDay(yy, mm)))}` }
const DAY = 86400000
const dnum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY

const STOP = new Set(['subscripcion', 'suscripcion', 'cuenta', 'pago', 'compra', 'tarjeta', 'debito', 'credito', 'automatico', 'transferencia', 'realizada', 'inmediata', 'recibida', 'mensual', 'cuota', 'para', 'merpago', 'mercpago', 'mercado', 'abono', 'servicio', 'sobre', 'impuesto', 'comision', 'mantenimiento', 'varios', 'super', 'supermercado', 'supermercados'])
export function words(t) {
  return [...new Set(`${t.note || ''} ${t.rawDesc || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/\d/.test(w) && !STOP.has(w)))]
}

// Fechas en que toca el pago entre from y to (inclusive)
export function occurrences(r, from, to) {
  const out = []
  let y = +from.slice(0, 4), m = +from.slice(5, 7)
  for (let i = 0; i < 40; i++) {
    const d = r.freq === 'yearly' ? (m === r.month ? dateIn(y, m, r.day) : null) : dateIn(y, m, r.day)
    if (d && d > to) break
    if (d && d >= from && (!r.start || d.slice(0, 7) >= r.start)) out.push(d)
    if (dateIn(y, m, 1) > to) break
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

// Monto esperado en pesos (centavos) para una fecha: en USD, con el promedio del mes (fx) o la última cotización
export function expectedAmount(r, date, fx) {
  if (r.currency !== 'USD') return r.amount
  const k = date.slice(0, 7)
  let rate = fx?.[k]
  if (!rate && fx) { const prev = Object.keys(fx).filter((x) => x <= k).sort().at(-1); rate = prev ? fx[prev] : null }
  rate = rate || r.rate
  return rate ? Math.round(r.origAmount * rate) : r.amount || 0
}

// ¿Ya está pagado? Un gasto confirmado desde este recurrente, o uno con la misma palabra y monto parecido cerca de la fecha
export function findPayment(r, date, txs) {
  const d0 = dnum(date)
  const winBefore = r.freq === 'yearly' ? 20 : 8, winAfter = r.freq === 'yearly' ? 25 : 12
  let best = null
  for (const t of txs) {
    if (t.type !== 'expense') continue
    const dd = dnum(t.date) - d0
    if (dd < -winBefore || dd > winAfter) continue
    if (t.recurringId === r.id) return t
    if (!r.key || !words(t).includes(r.key)) continue
    const okAmt = r.currency === 'USD' && t.currency === 'USD' && t.origAmount ? Math.abs(t.origAmount - r.origAmount) <= r.origAmount * 0.6
      : r.amount ? t.amount >= r.amount * 0.4 && t.amount <= r.amount * 2.5 : true
    if (okAmt && (!best || Math.abs(dnum(best.date) - d0) > Math.abs(dd))) best = t
  }
  return best
}

// Sugerencias: palabras que aparecen en gastos de 3 meses distintos (2 si fue en dólares), con montos parecidos
export function suggest(txs, existing = [], dismissed = [], today) {
  const since = (() => { const d = new Date(today + 'T12:00:00'); d.setMonth(d.getMonth() - 8); return d.toLocaleDateString('sv') })()
  const taken = new Set([...existing.map((r) => r.key), ...dismissed])
  const by = new Map()
  for (const t of txs) {
    if (t.type !== 'expense' || t.installment || t.date < since || t.date > today || /cuota|\bc\d+\/\d+/i.test(t.note || '')) continue
    for (const w of words(t)) { if (!by.has(w)) by.set(w, []); by.get(w).push(t) }
  }
  const out = []
  for (const [w, list] of by) {
    if (taken.has(w)) continue
    const months = new Set(list.map((t) => t.date.slice(0, 7)))
    const usd = list.filter((t) => t.currency === 'USD' && t.origAmount)
    // montos estables mes a mes (se permite que suban de a poco por inflación); en dólares alcanza con 2 meses
    const seq = [...list].sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => t.amount)
    const stable = seq.every((v, i) => i === 0 || (v <= seq[i - 1] * 1.35 && v >= seq[i - 1] / 1.35))
    const isUsd = usd.length >= 2
    if ((!isUsd && !stable) || months.size < (isUsd ? 2 : 3) || months.size < list.length * 0.5) continue
    const last = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    const cats = {}; for (const t of list) cats[t.categoryId] = (cats[t.categoryId] || 0) + 1
    out.push({
      key: w, name: w[0].toUpperCase() + w.slice(1), n: months.size,
      amount: last.amount, currency: last.currency === 'USD' && last.origAmount ? 'USD' : 'ARS', origAmount: last.currency === 'USD' ? last.origAmount : null, rate: last.rate || null,
      categoryId: Object.entries(cats).sort((a, b) => b[1] - a[1])[0][0], day: +last.date.slice(8), lastDate: last.date,
      txIds: list.map((t) => t.id),
      score: (isUsd ? 2 : 0) + (list.some((t) => (t.tagIds || []).length) ? 0 : 0) + (list.every((t) => t.amount === list[0].amount) ? 0 : 1),
    })
  }
  // si dos palabras describen los mismos cobros ("microsoft" y "office"), queda la de más meses
  out.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
  out.sort((a, b) => b.score - a.score) // primero lo que parece cobro automático: en dólares, con montos que varían de a poco
  const seen = new Set()
  return out.filter((s) => { const dup = s.txIds.some((id) => seen.has(id)); s.txIds.forEach((id) => seen.add(id)); return !dup })
}
