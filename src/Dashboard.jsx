import { useState } from 'preact/hooks'
import { S, tagById, balances, catById } from './lib/store.js'
import { money as money0, today, fromISO, toISO, monthName, monthShort, pad } from './lib/format.js'
import { Bars, Lines, HBars, Legend } from './charts.jsx'
import { Icon } from './ui.jsx'

const money = (c, o = {}) => money0(c, { decimals: false, ...o })
const C_INC = 'var(--series-1)'
const C_EXP = 'var(--series-2)'
const C_PREV = 'var(--muted)'

export function Dashboard({ openAccounts }) {
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const y = anchor.getFullYear(), m = anchor.getMonth()
  const key = (yy, mm) => `${yy}-${pad(mm + 1)}`
  const cur = key(y, m)
  const prevD = new Date(y, m - 1, 1)
  const prev = key(prevD.getFullYear(), prevD.getMonth())
  const isCurrentMonth = cur === today().slice(0, 7)
  const dayNow = isCurrentMonth ? Number(today().slice(8)) : new Date(y, m + 1, 0).getDate()
  const daysCur = new Date(y, m + 1, 0).getDate()
  const daysPrev = new Date(prevD.getFullYear(), prevD.getMonth() + 1, 0).getDate()

  const exp = S.txs.filter((t) => t.type === 'expense')
  const inc = S.txs.filter((t) => t.type === 'income')
  const sumMonth = (arr, k) => arr.filter((t) => t.date.startsWith(k)).reduce((s, t) => s + t.amount, 0)

  // acumulado diario
  const cum = (k, days, upto) => {
    const v = Array(days).fill(0)
    for (const t of exp) if (t.date.startsWith(k)) v[Number(t.date.slice(8)) - 1] += t.amount
    const out = []; let s = 0
    for (let i = 0; i < days; i++) { s += v[i]; out.push(i < upto ? s : null) }
    return out
  }
  const days = Math.max(daysCur, daysPrev)
  const curCum = cum(cur, days, Math.min(dayNow, daysCur))
  const prevCum = cum(prev, days, daysPrev)
  const spentCur = sumMonth(exp, cur)
  const prevAtSameDay = prevCum[Math.min(dayNow, daysPrev) - 1] || 0
  const delta = spentCur - prevAtSameDay

  // últimos 12 meses
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - i, 1); const k = key(d.getFullYear(), d.getMonth())
    months.push({ label: monthShort(d.getMonth()).slice(0, 1).toUpperCase() + monthShort(d.getMonth()).slice(1, 3), full: `${cap(monthName(d.getMonth()))} ${d.getFullYear()}`, inc: sumMonth(inc, k), exp: sumMonth(exp, k) })
  }

  // por etiqueta (mes elegido)
  const byTag = new Map()
  let fixed = 0
  for (const t of exp) {
    if (!t.date.startsWith(cur)) continue
    for (const id of t.tagIds || []) byTag.set(id, (byTag.get(id) || 0) + t.amount)
    if ((t.tagIds || []).some((id) => tagById(id)?.name.toLowerCase() === 'fijo')) fixed += t.amount
  }
  const tagRows = [...byTag.entries()].map(([id, value]) => ({ label: tagById(id)?.name || '—', value })).sort((a, b) => b.value - a.value)

  // categorías que más crecieron vs mes anterior
  const catDelta = new Map()
  for (const t of exp) {
    if (t.date.startsWith(cur)) catDelta.set(t.categoryId, (catDelta.get(t.categoryId) || 0) + t.amount)
    else if (t.date.startsWith(prev)) catDelta.set(t.categoryId, (catDelta.get(t.categoryId) || 0) - t.amount)
  }

  const bal = balances()
  const accounts = S.accounts.filter((a) => !a.archived)
  const totalBal = accounts.reduce((s, a) => s + (bal[a.id] || 0), 0)

  return (
    <main class="screen">
      <header class="top month-nav">
        <button class="icon-btn" onClick={() => setAnchor(new Date(y, m - 1, 1))} aria-label="Mes anterior"><Icon name="left" /></button>
        <h1>{cap(monthName(m))} {y !== new Date().getFullYear() ? y : ''}</h1>
        <button class="icon-btn" onClick={() => setAnchor(new Date(y, m + 1, 1))} aria-label="Mes siguiente"><Icon name="right" /></button>
      </header>

      <section class="hero">
        <p class="hero-label">{isCurrentMonth ? 'Gastado en lo que va del mes' : 'Gastado en el mes'}</p>
        <p class="hero-val num">{money(spentCur)}</p>
        {prevAtSameDay > 0 && (
          <p class="hero-sub">
            {isCurrentMonth ? `Al día ${dayNow} de ${monthName(prevD.getMonth())} llevabas ${money(prevAtSameDay)}: ` : `En ${monthName(prevD.getMonth())} gastaste ${money(prevAtSameDay)}: `}
            <b class={delta > 0 ? 'neg' : 'pos'}>{delta > 0 ? `${money(delta)} más` : `${money(-delta)} menos`}</b>
          </p>
        )}
        <div class="stats3">
          <div><span>Ingresos</span><b class="num pos">{money(sumMonth(inc, cur))}</b></div>
          <div><span>Fijos</span><b class="num">{money(fixed)}</b></div>
          <div><span>Balance</span><b class={`num ${sumMonth(inc, cur) - spentCur >= 0 ? 'pos' : 'neg'}`}>{money(sumMonth(inc, cur) - spentCur, { sign: sumMonth(inc, cur) - spentCur < 0 ? '−' : '' })}</b></div>
        </div>
      </section>

      <section class="card">
        <h2>Gasto acumulado</h2>
        <Legend items={[{ label: cap(monthName(m)), color: C_EXP }, { label: cap(monthName(prevD.getMonth())), color: C_PREV, dashed: true }]} />
        <Lines days={days} xLabel={(d) => `Día ${d}`} series={[
          { label: cap(monthName(m)), color: C_EXP, values: curCum },
          { label: cap(monthName(prevD.getMonth())), color: C_PREV, values: prevCum, dashed: true },
        ]} />
      </section>

      <section class="card">
        <h2>Ingresos y gastos, últimos 12 meses</h2>
        <Legend items={[{ label: 'Ingresos', color: C_INC }, { label: 'Gastos', color: C_EXP }]} />
        <Bars data={months} series={[{ key: 'inc', label: 'Ingresos', color: C_INC }, { key: 'exp', label: 'Gastos', color: C_EXP }]} />
      </section>

      <section class="card">
        <h2>Cambios contra {monthName(prevD.getMonth())}</h2>
        <ul class="delta-list">
          {[...catDelta.entries()].filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([id, v]) => {
            const c = catById(id)
            return <li><span>{c?.emoji || '❔'} {c?.name || 'Sin categoría'}</span><b class={`num ${v > 0 ? 'neg' : 'pos'}`}>{v > 0 ? '+' : '−'}{money(Math.abs(v)).slice(0)}</b></li>
          })}
        </ul>
      </section>

      {tagRows.length > 0 && (
        <section class="card">
          <h2>Gastos por etiqueta</h2>
          <HBars rows={tagRows} color={C_EXP} />
        </section>
      )}

      <section class="card">
        <div class="card-head"><h2>Cuentas</h2><button class="link-btn" onClick={openAccounts}>Editar</button></div>
        <ul class="acc-list">
          {accounts.map((a) => <li><span>{a.name}</span><b class={`num ${(bal[a.id] || 0) < 0 ? 'neg' : ''}`}>{money(bal[a.id] || 0, { sign: (bal[a.id] || 0) < 0 ? '−' : '' })}</b></li>)}
          {accounts.length > 1 && <li class="total"><span>Total</span><b class="num">{money(totalBal, { sign: totalBal < 0 ? '−' : '' })}</b></li>}
        </ul>
        {accounts.every((a) => !a.initial) && <p class="fine">Los saldos parten de cero. Cargá el saldo inicial de cada cuenta en Más → Cuentas.</p>}
      </section>
    </main>
  )
}
const cap = (s) => s[0].toUpperCase() + s.slice(1)
