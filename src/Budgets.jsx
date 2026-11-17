import { useEffect, useState } from 'preact/hooks'
import { S, put, remove, catById } from './lib/store.js'
import { money as money0, parseAmount, today, monthName } from './lib/format.js'
import { budgetStatus, monthTotals, rateFor } from './lib/budgets.js'
import { fetchRate, RATE_KINDS } from './lib/rates.js'
import { Icon, Seg, Sheet, toast, confirmDialog } from './ui.jsx'

const money = (c, o = {}) => money0(c, { decimals: false, ...o })
const curMonth = () => today().slice(0, 7)
const monthLabel = (k) => { const [y, m] = k.split('-').map(Number); const n = monthName(m - 1); return `${n[0].toUpperCase()}${n.slice(1)} ${y}` }

// Presupuestos activos en el mes k, con su estado, ordenados por lo más ajustado primero
export function budgetRows(k) {
  const totals = monthTotals(S.txs)
  return S.budgets
    .map((b) => ({ b, c: catById(b.categoryId), st: budgetStatus(b, k, totals, S.fx) }))
    .filter((r) => r.c && r.st)
    .sort((x, y) => y.st.pct - x.st.pct)
}

// Una fila: categoría, disponible, barra de consumo y detalle del arrastre.
// `pace` (0–1) marca cuánto del mes ya pasó, para ver si vas adelantado.
const usd = (cents) => `US$ ${(cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const kindName = () => RATE_KINDS.find((x) => x.id === (S.settings.rateKind || 'bolsa'))?.name || 'MEP'

export function BudgetRow({ b, c, st, pace, onClick, compact }) {
  const over = st.available < 0
  const pct = st.total > 0 ? Math.min(1, st.spent / st.total) : st.spent > 0 ? 1 : 0
  const level = over ? 'over' : st.total > 0 && st.spent / st.total >= 0.85 ? 'warn' : 'ok'
  const detail = [`Gastado ${money(st.spent)} de ${money(st.total)}`]
  if (st.carry) detail.push(`${st.carry > 0 ? '+' : '−'}${money(Math.abs(st.carry))} del mes anterior`)
  if (b.mode === 'percent') detail.push(`${String(b.value).replace('.', ',')}% de ${money(st.income)}`)
  if (b.currency === 'USD') detail.push(st.rate ? `${usd(b.value)} a ${money(Math.round(st.rate * 100))} (${kindName()})` : `${usd(b.value)}: sin cotización todavía`)
  return (
    <li>
      <button class={`bud-row${compact ? ' compact' : ''}`} onClick={onClick}>
        <span class="bud-top">
          <span class="bud-name">{c.emoji} {c.name}</span>
          <b class={`num ${over ? 'neg' : ''}`}>{over ? `Te pasaste ${money(-st.available)}` : `Quedan ${money(st.available)}`}</b>
        </span>
        <span class="bud-track" style={{ '--c': c.color }}>
          <span class={`bud-fill ${level}`} style={{ width: `${pct * 100}%` }} />
          {pace != null && <i class="bud-pace" style={{ left: `${pace * 100}%` }} aria-hidden="true" />}
        </span>
        {!compact && <small class="bud-detail">{detail.join(' · ')}</small>}
      </button>
    </li>
  )
}

// ---------- Pantalla de configuración (Más → Presupuestos) ----------
export function BudgetsPage() {
  const [edit, setEdit] = useState(null)
  const k = curMonth()
  const rows = budgetRows(k)
  const pending = S.budgets.filter((b) => b.start > k && catById(b.categoryId))
  const free = S.categories.filter((c) => c.kind === 'expense' && !c.archived && !S.budgets.some((b) => b.categoryId === c.id))
  return (
    <>
      <p class="fine pad-x">Un tope por mes para cada categoría que quieras controlar: monto fijo o un porcentaje de tus ingresos del mes. Si te sobra, se suma al mes siguiente; si te pasás, se descuenta.</p>
      {rows.length > 0 && (
        <ul class="bud-list pad-x">
          {rows.map((r) => <BudgetRow {...r} onClick={() => setEdit(r.b)} />)}
        </ul>
      )}
      {pending.length > 0 && (
        <ul class="menu">
          {pending.map((b) => { const c = catById(b.categoryId); return <li><button onClick={() => setEdit(b)}><span>{c.emoji} {c.name}<small>Empieza en {monthLabel(b.start)}</small></span><Icon name="right" size={18} /></button></li> })}
        </ul>
      )}
      {free.length > 0
        ? <button class="btn ghost wide" onClick={() => setEdit({ categoryId: free[0].id, mode: 'fixed', value: 0, rollover: true, start: k })}><Icon name="plus" size={18} /> Nuevo presupuesto</button>
        : <p class="fine pad-x">Todas tus categorías de gastos ya tienen presupuesto.</p>}
      <BudgetSheet b={edit} free={free} onClose={() => setEdit(null)} />
    </>
  )
}

function BudgetSheet({ b, free, onClose }) {
  const [v, setV] = useState(null)
  const [valStr, setValStr] = useState('')
  const [rate, setRate] = useState(null) // cotización de hoy, para mostrar la equivalencia en pesos
  const isUsd = v?.mode === 'fixed' && v?.currency === 'USD'
  useEffect(() => {
    if (!isUsd) return
    let alive = true
    fetchRate(S.settings.rateKind || 'bolsa', today(), 'venta').then((r) => alive && setRate(r)).catch(() => {})
    return () => { alive = false }
  }, [isUsd])
  useEffect(() => {
    if (!b) return setV(null)
    setV({ ...b })
    setValStr(!b.value ? '' : b.mode === 'percent' ? String(b.value).replace('.', ',') : (b.value / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 }))
    setRate(null)
  }, [b])
  if (!b || !v) return null
  const cats = b.id ? [catById(b.categoryId)].filter(Boolean) : free
  const parsed = parseAmount(valStr.replace('%', '')) // centavos
  const value = v.mode === 'percent' ? parsed / 100 : parsed
  const ok = Number.isFinite(value) && value > 0 && (v.mode !== 'percent' || value <= 100)
  const save = async () => {
    if (!ok) return toast(v.mode === 'percent' ? 'Escribí un porcentaje entre 1 y 100' : 'Escribí un monto')
    if (!/^\d{4}-\d{2}$/.test(v.start || '')) return toast('Elegí el mes de inicio')
    const obj = { ...v, value, currency: v.mode === 'fixed' && v.currency === 'USD' ? 'USD' : 'ARS' }
    if (obj.currency === 'USD') { const r = rate || rateFor(obj, today().slice(0, 7), S.fx); if (r) obj.rate = r }
    else delete obj.rate
    await put('budgets', obj)
    onClose(); toast(b.id ? 'Presupuesto actualizado' : 'Presupuesto creado')
  }
  const del = async () => {
    if (!confirmDialog('¿Eliminar este presupuesto? Tus gastos no se tocan.')) return
    await remove('budgets', b.id); onClose(); toast('Presupuesto eliminado')
  }
  const setMode = (mode) => { if (mode !== v.mode) { setV({ ...v, mode }); setValStr('') } }
  return (
    <Sheet open title={b.id ? 'Editar presupuesto' : 'Nuevo presupuesto'} onClose={onClose}>
      <div class="form">
        <label class="sel"><span>Categoría</span>
          <select value={v.categoryId} disabled={!!b.id} onChange={(e) => setV({ ...v, categoryId: e.currentTarget.value })}>
            {cats.map((c) => <option value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
        </label>
        <span class="lbl">Tope por mes</span>
        <Seg small value={v.mode} onChange={setMode} options={[{ value: 'fixed', label: 'Monto fijo' }, { value: 'percent', label: '% de mis ingresos' }]} />
        <label class="sel amount-sel">
          <span>{v.mode === 'percent' ? 'Porcentaje' : 'Monto'}</span>
          <span class="affix">{v.mode === 'percent' ? null : <button type="button" class="cur-mini" onClick={(e) => { e.preventDefault(); setV({ ...v, currency: isUsd ? 'ARS' : 'USD' }) }} aria-label="Cambiar moneda">{isUsd ? 'US$' : '$'}</button>}<input inputmode="decimal" value={valStr} placeholder={v.mode === 'percent' ? '15' : isUsd ? '100' : '150.000'} onInput={(e) => setValStr(e.currentTarget.value)} />{v.mode === 'percent' ? <i>%</i> : null}</span>
        </label>
        {v.mode === 'fixed' && <p class="fine">{isUsd
          ? <>Cada mes se pasa a pesos con el dólar {kindName()} promedio de ese mes{(() => { const r = rate || rateFor({ currency: 'USD' }, today().slice(0, 7), S.fx); return r && Number.isFinite(parsed) && parsed > 0 ? <>: hoy serían <b class="num">{money(Math.round(parsed * r))}</b></> : '' })()}. Tocá US$ para volver a pesos.</>
          : 'Tocá $ para ponerlo en dólares.'}</p>}
        {v.mode === 'percent' && <p class="fine">Se calcula sobre lo que cobraste ese mes: hasta que cargues los ingresos, el tope es cero.</p>}
        <label class="remember"><input type="checkbox" checked={v.rollover} onChange={(e) => setV({ ...v, rollover: e.currentTarget.checked })} /> Pasar al mes siguiente lo que sobra o falta</label>
        <label class="sel"><span>Empieza en</span>
          <input type="month" value={v.start} onInput={(e) => e.currentTarget.value && setV({ ...v, start: e.currentTarget.value })} />
        </label>
        <p class="fine">El arrastre se cuenta desde este mes. Si cambiás el tope, se recalcula desde acá.</p>
        {b.id && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Eliminar</button>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}
