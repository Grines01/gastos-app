// Gastos compartidos: cargás el total y la app lleva la cuenta de quién te debe su parte.
// En el gasto: split = { me: true, people: [{ name, amount, paidId?, waived? }] }
//   amount: centavos que te debe esa persona · paidId: el ingreso (reintegro) con que te pagó · waived: "no me debe"
// El reintegro es un ingreso con splitOf = id del gasto (así el gasto real es total − reintegros).
import { S } from './store.js'
import { splitAmount } from './cards.js'

const DAY = 86400000
const dnum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
export const cleanName = (s) => s.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase())

// Partes iguales; si participás, tu parte absorbe el redondeo
export function shares(total, names, me = true) {
  const n = names.length + (me ? 1 : 0)
  if (!n || !(total > 0)) return { mine: 0, each: [] }
  if (!me) return { mine: 0, each: splitAmount(total, n) }
  const per = Math.round(total / n / 100) * 100 // a los demás, en pesos redondos; vos absorbés la diferencia
  return { mine: total - per * names.length, each: names.map(() => per) }
}

export const isOpen = (p) => !p.paidId && !p.waived
export const owedOf = (t) => (t.split?.people || []).filter(isOpen).reduce((s, p) => s + p.amount, 0)

// Gastos compartidos con alguien que todavía no pagó (más viejos primero)
export function openSplits() {
  return S.txs.filter((t) => t.type === 'expense' && t.split?.people?.some(isOpen)).sort((a, b) => (a.date < b.date ? -1 : 1))
}
export function owedSummary() {
  const open = openSplits()
  const names = [...new Set(open.flatMap((t) => t.split.people.filter(isOpen).map((p) => p.name)))]
  return { total: open.reduce((s, t) => s + owedOf(t), 0), names, n: open.length }
}

// Nombres usados antes, los más frecuentes primero (para sugerirlos al cargar)
export function knownNames() {
  const c = new Map()
  for (const t of S.txs) for (const p of t.split?.people || []) c.set(p.name, (c.get(p.name) || 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n)
}

// Categoría para los reintegros: Cashback si existe, si no Reintegros, si no la primera de ingresos
export function refundCategoryId() {
  const inc = S.categories.filter((c) => c.kind === 'income' && !c.archived)
  return (inc.find((c) => norm(c.name) === 'cashback') || inc.find((c) => norm(c.name).startsWith('reintegro')) || inc[0])?.id || null
}

// ¿Ya entró la transferencia? Un ingreso sin vincular, desde el día del gasto hasta 45 días después,
// con un monto parecido (±3 %) y el nombre en la descripción ("Leo" → "De Leonardo Pérez")
export function findPayment(expense, person) {
  const used = new Set(S.txs.flatMap((t) => (t.split?.people || []).map((p) => p.paidId).filter(Boolean)))
  const nw = norm(person.name).split(/\s+/).filter((w) => w.length >= 2)
  if (!nw.length) return null
  const d0 = dnum(expense.date)
  let best = null
  for (const t of S.txs) {
    if (t.type !== 'income' || used.has(t.id) || t.splitOf) continue
    const dd = dnum(t.date) - d0
    if (dd < 0 || dd > 45) continue
    if (Math.abs(t.amount - person.amount) > Math.max(100, person.amount * 0.03)) continue
    const words = norm(`${t.note || ''} ${t.rawDesc || ''}`).split(/[^a-z0-9]+/)
    if (!nw.every((w) => words.some((x) => x.startsWith(w)))) continue
    if (!best || dd < dnum(best.date) - d0) best = t
  }
  return best
}
