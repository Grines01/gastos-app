import { useState } from 'preact/hooks'
import { S, catById } from './lib/store.js'
import { range, inRange } from './lib/period.js'
import { money } from './lib/format.js'
import { NEUTRAL, UNCAT } from './lib/defaults.js'
import { PeriodBar } from './PeriodBar.jsx'
import { Donut } from './charts.jsx'
import { Seg, Empty, Icon } from './ui.jsx'

export function Home({ period, setPeriod, kind, setKind, openCategory, onAdd, nPending, openPending }) {
  const [sel, setSel] = useState(null)
  const rg = range(period)
  const inP = S.txs.filter((t) => inRange(t.date, rg))
  const exp = inP.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const inc = inP.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const list = inP.filter((t) => t.type === kind)
  const total = kind === 'expense' ? exp : inc

  const by = new Map()
  for (const t of list) by.set(t.categoryId || null, (by.get(t.categoryId || null) || 0) + t.amount)
  const rows = [...by.entries()].map(([id, value]) => {
    const c = id ? catById(id) : null
    return { id: id || 'none', catId: id, label: c?.name || 'Sin categoría', emoji: c?.emoji || '❔', color: c?.color || UNCAT, value, count: list.filter((t) => (t.categoryId || null) === id).length }
  }).sort((a, b) => b.value - a.value)

  // la dona muestra las 5 mayores + "Resto"; la lista muestra todas
  const top = rows.slice(0, 5)
  const rest = rows.slice(5).reduce((s, r) => s + r.value, 0)
  const slices = rest > 0 ? [...top, { id: 'rest', label: 'Resto', color: NEUTRAL, value: rest }] : top

  return (
    <main class="screen">
      <header class="top">
        <Seg value={kind} onChange={(v) => { setKind(v); setSel(null) }} options={[{ value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }]} />
      </header>
      {nPending > 0 && (
        <button class="pending-banner" onClick={openPending}>
          <span><b>{nPending === 1 ? '1 movimiento sin categoría' : `${nPending} movimientos sin categoría`}</b>. Tocá para categorizarlos.</span>
          <Icon name="right" size={18} />
        </button>
      )}
      <PeriodBar period={period} setPeriod={(p) => { setPeriod(p); setSel(null) }} />

      {list.length === 0 ? (
        <Empty title={kind === 'expense' ? 'No hay gastos en este período' : 'No hay ingresos en este período'}>
          <button class="btn primary" onClick={() => onAdd(kind)}>{kind === 'expense' ? 'Cargar un gasto' : 'Cargar un ingreso'}</button>
        </Empty>
      ) : (
        <>
          <Donut data={slices} selected={sel} onSelect={setSel}
            center={<><span class="dc-label">{kind === 'expense' ? 'Gastado' : 'Ingresado'}</span><span class="dc-val num">{money(total, { decimals: false })}</span><span class="dc-sub">{list.length} movimientos</span></>} />
          <div class="stats3">
            <div><span>Ingresos</span><b class="num pos">{money(inc, { decimals: false })}</b></div>
            <div><span>Gastos</span><b class="num">{money(exp, { decimals: false })}</b></div>
            <div><span>Balance</span><b class={`num ${inc - exp >= 0 ? 'pos' : 'neg'}`}>{money(inc - exp, { decimals: false, sign: inc - exp < 0 ? '−' : '' })}</b></div>
          </div>
          <ul class="cat-list">
            {rows.map((r) => (
              <li>
                <button class={`cat-row${sel === r.id ? ' on' : ''}${r.catId ? '' : ' uncat'}`} onClick={() => openCategory(r.catId, kind)}>
                  <span class="dot" style={{ background: r.color }} />
                  <span class="cr-emoji" aria-hidden="true">{r.emoji}</span>
                  <span class="cr-name">{r.label}<small>{r.count} {r.count === 1 ? 'movimiento' : 'movimientos'}</small></span>
                  <span class="cr-pct">{Math.round((r.value / total) * 100)}%</span>
                  <span class="cr-val num">{money(r.value, { decimals: false })}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
