// Plan financiero: metas con fecha, reparto de cada cobro y recordatorios.
// El plan es un archivo (lo armamos por fuera) que se carga y queda en settings.plan. No forma parte de la app.
//
// { app: 'gastos-plan', version: 1, name, createdAt,
//   scenario: { conservative|base|optimistic: { incomeUsd, spendUsd, saveUsd } },
//   goals: [{ id, name, amountUsd, due: 'YYYY-MM', priority, where, monthlyUsd, note,
//             kind: 'save' | 'budget',                       // juntar plata | tope de gasto
//             source: 'liquid' | 'invested' | 'manual',      // save: de dónde sale el avance (fotos de Patrimonio o a mano)
//             category, from: 'YYYY-MM',                     // budget: categoría de gasto y desde cuándo cuenta
//             startUsd }],                                   // save: con cuánto arrancó
//   split: [{ to: goalId | 'disfrute', label, pct }], splitFallback: goalId,   // reparto de cada comisión
//   rules: [texto], reminders: [{ id, text, every: 'month'|'quarter'|'year'|'once', day, month, date }] }
import { S, today } from './store.js'
import { summary } from './wealth.js'
import { spendEntries, incomeEntries } from './metrics.js'

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const pad = (n) => String(n).padStart(2, '0')
const ym = (d) => d.slice(0, 7)
const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) // 'YYYY-MM' → meses
const lastDay = (y, m) => new Date(y, m, 0).getDate()
const dateOf = (y, m, day) => `${y}-${pad(m)}-${pad(Math.min(day || 1, lastDay(y, m)))}`
const DAY = 86400000
const dnum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY

export function parsePlan(data) {
  if (data?.app !== 'gastos-plan' || !Array.isArray(data.goals)) throw new Error('No es un archivo de plan')
  return { ...data, loadedAt: Date.now() }
}
export const plan = () => S.settings.plan || null
export const planState = () => S.settings.planState || {}

// dólar para pasar pesos a US$: el de la última foto de Patrimonio o, si no hay, el promedio del mes
const rateFor = (date) => S.snapshots.at(-1)?.rate || S.fx?.[ym(date)] || Object.values(S.fx || {}).at(-1) || null
const usdOf = (t, sign = 1) => (t.currency === 'USD' && t.origAmount ? sign * t.origAmount : (() => { const r = rateFor(t.date); return r ? (sign * t.amount) / r : 0 })()) / 100

// Avance de una meta: { current, expected, pct, status: 'done'|'ok'|'late'|'over'|'nodata', monthsLeft, needMonthly }
export function goalProgress(g, p = plan(), t0 = today()) {
  const nowM = ym(t0), from = g.from || ym(p.createdAt || t0)
  const total = Math.max(1, monthsBetween(from, g.due)), elapsed = Math.min(total, Math.max(0, monthsBetween(from, nowM)))
  const monthsLeft = Math.max(0, monthsBetween(nowM, g.due))
  let current = null
  if (g.kind === 'budget') {
    const cat = S.categories.find((c) => c.kind === 'expense' && norm(c.name) === norm(g.category))
    // las cuotas de compras anteriores al plan no cuentan (ej. la última cuota de algo comprado antes)
    current = cat ? spendEntries().filter((e) => e.categoryId === cat.id && ym(e.date) >= from && ym(e.date) <= g.due && !(e.t.installment?.purchase && ym(e.t.installment.purchase) < from)).reduce((s, e) => s + usdOf(e.t, Math.sign(e.amount)), 0) : 0
    const expected = g.amountUsd * (nowM < from ? 0 : (elapsed + 1) / (total + 1))
    return { current, expected, pct: g.amountUsd ? current / g.amountUsd : 0, status: nowM < from ? 'ok' : current > g.amountUsd * 1.02 ? 'over' : 'ok', monthsLeft, left: g.amountUsd - current, budget: true }
  }
  const snap = S.snapshots.at(-1), sm = snap && summary(snap)
  if (g.source === 'liquid') current = sm ? sm.liquid / 100 : null
  else if (g.source === 'invested') current = sm ? (sm.assets - sm.liquid) / 100 : null
  else current = planState().saved?.[g.id] ?? g.startUsd ?? 0
  if (current == null) return { current: null, status: 'nodata', monthsLeft }
  const start = g.startUsd || 0
  const expected = start + (g.amountUsd - start) * (elapsed / total)
  const left = Math.max(0, g.amountUsd - current)
  const status = current >= g.amountUsd ? 'done' : current >= expected - g.amountUsd * 0.04 ? 'ok' : 'late'
  return { current, expected, pct: g.amountUsd ? current / g.amountUsd : 0, status, monthsLeft, left, needMonthly: monthsLeft > 0 ? left / monthsLeft : left, behind: Math.max(0, expected - current) }
}

// Reparto de un cobro (comisión): lo de una meta ya cumplida pasa a la meta de largo plazo
export function splitIncome(amountUsd, p = plan()) {
  const rows = new Map()
  for (const s of p.split || []) {
    const g = p.goals.find((x) => x.id === s.to)
    const isDone = (x) => x && goalProgress(x, p).status === 'done'
    const done = isDone(g)
    // splitFallback puede ser una lista: va a la primera meta que todavía no esté cumplida
    const fb = [].concat(p.splitFallback || []).find((id) => id !== s.to && !isDone(p.goals.find((x) => x.id === id)))
    const to = done ? fb || s.to : s.to
    const tg = p.goals.find((x) => x.id === to)
    const r = rows.get(to) || { to, label: tg?.name || s.label || to, pct: 0, moved: [] }
    r.pct += s.pct; if (done && to !== s.to) r.moved.push(g.name)
    rows.set(to, r)
  }
  return [...rows.values()].map((r) => ({ ...r, usd: (amountUsd * r.pct) / 100 }))
}

// En qué escenario estás: promedio de los últimos 3 meses completos (ingresos sin reintegros, gasto real), en US$
export function actuals(t0 = today()) {
  const d = new Date(t0 + 'T12:00:00')
  const keys = [1, 2, 3].map((i) => { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}` })
  const inc = incomeEntries().filter((t) => keys.includes(ym(t.date))).reduce((s, t) => s + usdOf(t), 0) / 3
  const exp = spendEntries().filter((e) => keys.includes(ym(e.date))).reduce((s, e) => s + usdOf(e.t, Math.sign(e.amount)), 0) / 3
  return { incomeUsd: inc, spendUsd: exp, saveUsd: inc - exp, hasData: inc > 0 || exp > 0 }
}
export function nearestScenario(a, p = plan()) {
  const names = { conservative: 'conservador', base: 'base', optimistic: 'optimista' }
  const e = Object.entries(p.scenario || {}).sort((x, y) => Math.abs(x[1].incomeUsd - a.incomeUsd) - Math.abs(y[1].incomeUsd - a.incomeUsd))[0]
  return e ? names[e[0]] || e[0] : null
}

// ---------- recordatorios ----------
// Fecha en que toca un recordatorio en el período que contiene a `ref` ('YYYY-MM-DD'), y su clave
function occurrence(r, y, m) {
  if (r.every === 'once') return { date: r.date, key: r.id }
  if (r.every === 'month') return { date: dateOf(y, m, r.day), key: `${r.id}|${y}-${pad(m)}` }
  if (r.every === 'quarter') { const qm = m - ((m - 1) % 3); return { date: dateOf(y, qm, r.day), key: `${r.id}|${y}-Q${(qm + 2) / 3}` } }
  return { date: dateOf(y, r.month || 1, r.day), key: `${r.id}|${y}` } // year
}
// Lo que ya tocó y no marcaste como hecho (hasta 45 días atrás; los de una sola vez, 90)
export function dueReminders(p = plan(), t0 = today()) {
  if (!p?.reminders) return []
  const done = planState().done || {}, y = +t0.slice(0, 4), m = +t0.slice(5, 7), out = []
  for (const r of p.reminders) {
    const cands = r.every === 'once' ? [occurrence(r)] : [occurrence(r, y, m), occurrence(r, m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1), occurrence(r, y - 1, m)]
    const hit = cands.filter((o) => o.date <= t0 && dnum(t0) - dnum(o.date) <= (r.every === 'once' ? 90 : 45)).sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    if (hit && !done[hit.key] && hit.date >= (p.createdAt || '')) out.push({ ...r, ...hit })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}
// Los próximos n (para verlos venir)
export function upcomingReminders(p = plan(), t0 = today(), n = 6) {
  if (!p?.reminders) return []
  const out = []
  for (const r of p.reminders) {
    if (r.every === 'once') { if (r.date > t0) out.push({ ...r, date: r.date }); continue }
    let y = +t0.slice(0, 4), m = +t0.slice(5, 7)
    for (let i = 0; i < 14; i++) {
      const o = occurrence(r, y, m)
      if (o.date > t0) { out.push({ ...r, ...o }); break }
      m++; if (m > 12) { m = 1; y++ }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, n)
}
