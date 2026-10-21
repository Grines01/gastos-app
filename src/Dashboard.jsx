import { useEffect, useState } from 'preact/hooks'
import { S, tagById, balances, catById } from './lib/store.js'
import { money as money0, today, monthName, monthShort, pad, shortDate } from './lib/format.js'
import { getSeries, monthlyAvg, RATE_KINDS } from './lib/rates.js'
import { Bars, Lines, HBars, Legend } from './charts.jsx'
import { Icon, Seg } from './ui.jsx'
import { budgetRows, BudgetRow } from './Budgets.jsx'

const money = (c, o = {}) => money0(c, { decimals: false, ...o })
const usd = (cents) => `US$ ${Math.round(cents / 100).toLocaleString('es-AR')}`
const C_INC = 'var(--series-1)'
const C_EXP = 'var(--series-2)'
const C_PREV = 'var(--muted)'
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const key = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const FX_KINDS = [
  { id: 'oficial', name: 'Oficial', color: 'var(--fx-oficial)' },
  { id: 'bolsa', name: 'MEP', color: 'var(--fx-mep)' },
  { id: 'blue', name: 'Blue', color: 'var(--fx-blue)' },
]
const isFixed = (t) => (t.tagIds || []).some((id) => tagById(id)?.name.toLowerCase() === 'fijo')

export function Dashboard({ anchor, setAnchor, openAccounts, openBudgets, openCategory, onEdit }) {
  const [unit, setUnit] = useState('ARS')
  const [fx, setFx] = useState(null) // { '2026-10': 1540, ... }
  const rateKind = S.settings.rateKind || 'bolsa'
  useEffect(() => { let alive = true; getSeries(rateKind).then((s) => alive && s && setFx(monthlyAvg(s))); return () => { alive = false } }, [rateKind])
  // evolución del dólar: promedio mensual (venta) de oficial, MEP y blue
  const [dollars, setDollars] = useState(null) // null cargando | 'error' | { oficial, bolsa, blue }
  useEffect(() => {
    let alive = true
    Promise.all(FX_KINDS.map((k) => getSeries(k.id))).then((arr) => {
      if (!alive) return
      setDollars(arr.every((x) => !x) ? 'error' : Object.fromEntries(FX_KINDS.map((k, i) => [k.id, arr[i] ? monthlyAvg(arr[i]) : {}])))
    })
    return () => { alive = false }
  }, [])

  const y = anchor.getFullYear(), m = anchor.getMonth()
  const cur = key(y, m), prev = key(y, m - 1)
  const prevD = new Date(y, m - 1, 1)
  const isCurrentMonth = cur === today().slice(0, 7)
  const daysCur = new Date(y, m + 1, 0).getDate()
  const daysPrev = new Date(y, m, 0).getDate()
  const dayNow = isCurrentMonth ? Number(today().slice(8)) : daysCur

  const exp = S.txs.filter((t) => t.type === 'expense')
  const inc = S.txs.filter((t) => t.type === 'income')
  const sumM = (arr, k, f) => arr.reduce((s, t) => (t.date.startsWith(k) && (!f || f(t)) ? s + t.amount : s), 0)
  const hasData = (k) => S.txs.some((t) => t.date.startsWith(k))

  // ---- mes elegido
  const spent = sumM(exp, cur), earned = sumM(inc, cur)
  const fixed = sumM(exp, cur, isFixed)
  const variable = spent - fixed
  // ---- referencia: promedio de los 3 meses anteriores con datos
  const prevKeys = [1, 2, 3].map((i) => key(y, m - i)).filter(hasData)
  const avg = (fn) => (prevKeys.length ? prevKeys.reduce((s, k) => s + fn(k), 0) / prevKeys.length : null)
  const avgSpent = avg((k) => sumM(exp, k))
  const avgFixed = avg((k) => sumM(exp, k, isFixed)) || 0
  const avgSave = avg((k) => { const i = sumM(inc, k); return i > 0 ? (i - sumM(exp, k)) / i : 0 })
  // ---- proyección de cierre: fijos habituales + ritmo diario de los variables
  const projected = isCurrentMonth && dayNow >= 3 ? Math.max(fixed, avgFixed) + (variable / dayNow) * daysCur : null
  const saveRate = earned > 0 ? (earned - spent) / earned : null
  const daily = variable / Math.max(1, dayNow)
  const fxCur = fx?.[cur] || (fx ? Object.values(fx).at(-1) : null)

  // ---- acumulado diario
  const cum = (k, days, upto) => {
    const v = Array(days).fill(0)
    for (const t of exp) if (t.date.startsWith(k)) { const d = Number(t.date.slice(8)) - 1; if (d < days) v[d] += t.amount }
    let s = 0
    return v.map((x, i) => { s += x; return i < upto ? s : null })
  }
  const days = Math.max(daysCur, daysPrev)
  const curCum = cum(cur, days, Math.min(dayNow, daysCur))
  const prevCum = cum(prev, days, daysPrev)

  // ---- últimos 12 meses (en pesos o en dólares al promedio del mes)
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - i, 1), k = key(d.getFullYear(), d.getMonth())
    const r = unit === 'USD' ? fx?.[k] : 1
    const conv = (v) => (r ? v / r : 0)
    months.push({ label: cap(monthShort(d.getMonth())), full: `${cap(monthName(d.getMonth()))} ${d.getFullYear()}`, inc: conv(sumM(inc, k)), exp: conv(sumM(exp, k)) })
  }

  // ---- dólar: últimos 12 meses y lo que cobraste en cada uno
  const fxMonths = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - i, 1), k = key(d.getFullYear(), d.getMonth())
    fxMonths.push({ k, short: cap(monthShort(d.getMonth())), full: `${cap(monthName(d.getMonth()))} ${d.getFullYear()}`, income: sumM(inc, k) })
  }
  const fxObj = dollars && dollars !== 'error' ? dollars : null
  const fxSeries = fxObj ? FX_KINDS.map((fk) => ({ label: fk.name, color: fk.color, values: fxMonths.map((mm) => (fxObj[fk.id]?.[mm.k] ? Math.round(fxObj[fk.id][mm.k] * 100) : null)) })) : []
  const fxHas = fxSeries.some((s) => s.values.some((v) => v != null))
  const usKind = FX_KINDS.find((k) => k.id === rateKind) ? rateKind : 'bolsa'
  const usName = FX_KINDS.find((k) => k.id === usKind).name
  const rateOf = (k) => fxObj?.[usKind]?.[k] || null
  const incomeRows = fxMonths.filter((mm) => mm.income > 0).reverse()
  const usdOf = (mm) => (rateOf(mm.k) ? mm.income / rateOf(mm.k) : null)

  // ---- categorías por encima de lo habitual
  const unusual = []
  if (prevKeys.length) {
    const byCat = new Map()
    for (const t of exp) {
      const k = t.date.slice(0, 7)
      if (k !== cur && !prevKeys.includes(k)) continue
      const e = byCat.get(t.categoryId) || { cur: 0, prev: 0 }
      if (k === cur) e.cur += t.amount; else e.prev += t.amount
      byCat.set(t.categoryId, e)
    }
    for (const [id, e] of byCat) {
      const a = e.prev / prevKeys.length
      if (e.cur > a * 1.25 && e.cur - a > Math.max(1000000, (avgSpent || 0) * 0.02)) unusual.push({ id, cur: e.cur, avg: a })
    }
    unusual.sort((a, b) => (b.cur - b.avg) - (a.cur - a.avg))
  }

  const biggest = exp.filter((t) => t.date.startsWith(cur)).sort((a, b) => b.amount - a.amount).slice(0, 5)

  const byTag = new Map()
  for (const t of exp) if (t.date.startsWith(cur)) for (const id of t.tagIds || []) byTag.set(id, (byTag.get(id) || 0) + t.amount)
  const tagRows = [...byTag.entries()].map(([id, value]) => ({ label: tagById(id)?.name || '—', value })).sort((a, b) => b.value - a.value)

  const budgets = budgetRows(cur)
  const pace = isCurrentMonth ? dayNow / daysCur : null

  const bal = balances()
  const accounts = S.accounts.filter((a) => !a.archived)
  const totalBal = accounts.reduce((s, a) => s + (bal[a.id] || 0), 0)
  const hasInitial = accounts.some((a) => a.initial)
  const runway = hasInitial && avgSpent > 0 && totalBal > 0 ? totalBal / avgSpent : null

  return (
    <main class="screen">
      <header class="top month-nav">
        <button class="icon-btn" onClick={() => setAnchor(new Date(y, m - 1, 1))} aria-label="Mes anterior"><Icon name="left" /></button>
        <h1>{cap(monthName(m))} {y !== new Date().getFullYear() ? y : ''}</h1>
        <button class="icon-btn" onClick={() => setAnchor(new Date(y, m + 1, 1))} aria-label="Mes siguiente"><Icon name="right" /></button>
      </header>

      <section class="hero">
        <p class="hero-label">{isCurrentMonth ? 'Gastado en lo que va del mes' : 'Gastado en el mes'}</p>
        <p class="hero-val num">{money(spent)}</p>
        {fxCur && spent > 0 && <p class="hero-usd num">≈ {usd(spent / fxCur)} al {RATE_KINDS.find((k) => k.id === rateKind)?.name} promedio del mes</p>}
        {projected != null && (
          <p class="hero-sub">A este ritmo cerrás el mes en <b class="num">{money(projected)}</b>{avgSpent ? <>, contra un promedio de <b class="num">{money(avgSpent)}</b></> : null}.</p>
        )}
        {projected == null && avgSpent ? (
          <p class="hero-sub">Tu promedio de los meses anteriores es <b class="num">{money(avgSpent)}</b>: {spent > avgSpent ? <b class="neg">{money(spent - avgSpent)} más</b> : <b class="pos">{money(avgSpent - spent)} menos</b>}.</p>
        ) : null}
      </section>

      <div class="tiles">
        <div class="tile">
          <span class="tile-l">Ahorro del mes</span>
          <b class={`tile-v num ${saveRate == null ? '' : saveRate >= 0 ? 'pos' : 'neg'}`}>{saveRate == null ? '—' : `${Math.round(saveRate * 100)}%`}</b>
          <span class="tile-s">{saveRate == null ? 'Sin ingresos cargados' : `${money(earned - spent, { sign: earned - spent < 0 ? '−' : '' })} de ${money(earned)}`}{avgSave != null ? `. Promedio ${Math.round(avgSave * 100)}%` : ''}</span>
        </div>
        <div class="tile">
          <span class="tile-l">Gasto variable por día</span>
          <b class="tile-v num">{money(daily)}</b>
          <span class="tile-s">Sin contar los fijos</span>
        </div>
        <div class="tile">
          <span class="tile-l">Fijos</span>
          <b class="tile-v num">{spent ? `${Math.round((fixed / spent) * 100)}%` : '—'}</b>
          <span class="tile-s">{money(fixed)} con etiqueta Fijo</span>
        </div>
      </div>

      <section class="card">
        <div class="card-head"><h2>Presupuestos</h2><button class="link-btn" onClick={openBudgets}>{S.budgets.length ? 'Editar' : 'Crear'}</button></div>
        {budgets.length ? (
          <>
            <ul class="bud-list">{budgets.map((r) => <BudgetRow {...r} pace={pace} onClick={() => openCategory(r.b.categoryId, cur)} />)}</ul>
            {pace != null && <p class="fine">La rayita marca cuánto del mes ya pasó: si la barra la supera, vas más rápido de lo que te alcanza.</p>}
          </>
        ) : <p class="fine">{S.budgets.length ? 'Ningún presupuesto empieza antes de este mes.' : 'Poné un tope por mes a las categorías que querés controlar. Lo que te sobra pasa al mes siguiente.'}</p>}
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
        <div class="card-head">
          <h2>Últimos 12 meses</h2>
          {fx && <Seg small value={unit} onChange={setUnit} options={[{ value: 'ARS', label: 'Pesos' }, { value: 'USD', label: 'Dólares' }]} />}
        </div>
        <Legend items={[{ label: 'Ingresos', color: C_INC }, { label: 'Gastos', color: C_EXP }]} />
        <Bars data={months} series={[{ key: 'inc', label: 'Ingresos', color: C_INC }, { key: 'exp', label: 'Gastos', color: C_EXP }]} />
        {unit === 'USD' && <p class="fine">En dólares {RATE_KINDS.find((k) => k.id === rateKind)?.name} al promedio de cada mes: así la inflación no distorsiona la comparación.</p>}
      </section>

      <section class="card">
        <h2>Dólar</h2>
        {dollars === null ? <p class="fine">Buscando cotizaciones…</p>
          : !fxHas ? <p class="fine">No pude traer las cotizaciones. Se necesita internet la primera vez; después quedan guardadas en el teléfono.</p>
          : (
            <>
              <Legend items={FX_KINDS.map((k) => ({ label: k.name, color: k.color }))} />
              <Lines label="Evolución del dólar" days={12} series={fxSeries} fit
                tick={(v) => Math.round(v / 100).toLocaleString('es-AR')}
                xTick={(i) => fxMonths[i].short} xLabel={(d) => fxMonths[d - 1].full}
                extra={(i) => { const mm = fxMonths[i]; const u = usdOf(mm); return mm.income > 0 ? <span class="tip-wide">Cobraste <b class="num">{money(mm.income)}</b>{u ? <> = <b class="num">{usd(u)}</b> al {usName}</> : null}</span> : null }} />
              <p class="fine">Promedio de cada mes, precio de venta. Tocá el gráfico para ver un mes.</p>
              {incomeRows.length > 0 && (
                <>
                  <h3 class="sub-h">Tus ingresos en dólares</h3>
                  <div class="fx-table" role="table">
                    <div class="fx-row fx-h" role="row"><span>Mes</span><span>Cobraste</span><span>{usName}</span><span>En US$</span></div>
                    {incomeRows.map((mm) => (
                      <div class="fx-row" role="row">
                        <span>{mm.short} {mm.k.slice(2, 4)}</span>
                        <span class="num">{money(mm.income)}</span>
                        <span class="num">{rateOf(mm.k) ? Math.round(rateOf(mm.k)).toLocaleString('es-AR') : '—'}</span>
                        <b class="num">{usdOf(mm) ? usd(usdOf(mm)) : '—'}</b>
                      </div>
                    ))}
                  </div>
                  <p class="fine">En US$ = lo que cobraste ese mes dividido el dólar {usName} promedio del mes. El dólar se cambia en Más → Dólar.</p>
                </>
              )}
            </>
          )}
      </section>

      <section class="card">
        <h2>Por encima de lo habitual</h2>
        {!prevKeys.length ? <p class="fine">Hace falta al menos un mes anterior con datos para comparar.</p>
          : unusual.length === 0 ? <p class="fine">Ninguna categoría está por encima de tu promedio de los últimos {prevKeys.length === 1 ? 'mes' : `${prevKeys.length} meses`}.</p>
          : (
            <ul class="delta-list">
              {unusual.slice(0, 5).map((u) => {
                const c = catById(u.id)
                return (
                  <li>
                    <button class="delta-row" onClick={() => openCategory(u.id || null, cur)}>
                      <span>{c?.emoji || '❔'} {c?.name || 'Sin categoría'}<small>{money(u.cur)} este mes · promedio {money(u.avg)}</small></span>
                      <b class="num neg">+{money(u.cur - u.avg)}</b>
                      <Icon name="right" size={16} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </section>

      {biggest.length > 0 && (
        <section class="card">
          <h2>Gastos más grandes</h2>
          <ul class="delta-list">
            {biggest.map((t) => {
              const c = catById(t.categoryId)
              return <li><button class="delta-row" onClick={() => onEdit(t)}><span>{c?.emoji || '❔'} {t.note || c?.name || 'Sin categoría'}<small>{shortDate(t.date)}{c ? ` · ${c.name}` : ''}</small></span><b class="num">{money(t.amount)}</b><Icon name="right" size={16} /></button></li>
            })}
          </ul>
        </section>
      )}

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
        {runway != null && <p class="runway">Tus saldos cubren <b class="num">{runway.toLocaleString('es-AR', { maximumFractionDigits: 1 })} meses</b> de gastos al ritmo de tu promedio.</p>}
        {!hasInitial && <p class="fine">Los saldos parten de cero. Cargá el saldo inicial de cada cuenta en Más → Cuentas para ver saldos reales y cuántos meses de gastos te cubren.</p>}
      </section>
    </main>
  )
}
