import { S, catById, saveSettings } from './lib/store.js'
import { range, inRange } from './lib/period.js'
import { money as ars, usdMoney, toUsd } from './lib/format.js'
import { RATE_KINDS } from './lib/rates.js'
import { NEUTRAL, UNCAT } from './lib/defaults.js'
import { PeriodBar } from './PeriodBar.jsx'
import { spendEntries, incomeEntries, refundCatIds } from './lib/metrics.js'
import { Seg, Empty, Icon } from './ui.jsx'

export function Home({ period, setPeriod, kind, setKind, openCategory, onAdd, nPending, openPending, nDupes, openDupes, alerts = [], openCards, future, openFuture, debts, openDebts }) {
  const rg = range(period)
  // gasto real (reintegros restados, sin lo programado a futuro) e ingresos sin reintegros: ver lib/metrics.js
  const expE = spendEntries().filter((e) => inRange(e.date, rg))
  const incE = incomeEntries().filter((t) => inRange(t.date, rg))
  // pesos o dólares: lo cargado en USD va con su monto exacto; el resto, al dólar promedio de su mes
  const wantUsd = S.settings.homeUnit === 'USD'
  const usd = wantUsd && !!S.fx
  const val = usd ? (e) => (Math.sign(e.amount) || 1) * (toUsd(e.t || e, S.fx) || 0) : (e) => e.amount
  const money = usd ? (c, o = {}) => usdMoney(c, o) : ars
  const rateName = RATE_KINDS.find((k) => k.id === (S.settings.rateKind || 'bolsa'))?.name
  const exp = expE.reduce((s, e) => s + val(e), 0)
  const inc = incE.reduce((s, t) => s + val(t), 0)
  const total = kind === 'expense' ? exp : inc

  // por categoría; los reintegros de gastos compartidos ya van restados en su categoría,
  // los demás (Cashback suelto, viáticos) en una fila aparte
  const by = new Map(), count = new Map()
  const listE = kind === 'expense' ? expE.filter((e) => e.refund !== 'other') : incE
  for (const e of listE) {
    const id = e.categoryId || null
    by.set(id, (by.get(id) || 0) + val(e))
    if (!e.refund) count.set(id, (count.get(id) || 0) + 1)
  }
  const rows = [...by.entries()].map(([id, value]) => {
    const c = id ? catById(id) : null
    return { id: id || 'none', catId: id, label: c?.name || 'Sin categoría', emoji: c?.emoji || '❔', color: c?.color || UNCAT, value, count: count.get(id) || 0 }
  }).filter((r) => r.count > 0 || r.value !== 0).sort((a, b) => b.value - a.value)
  const other = kind === 'expense' ? expE.filter((e) => e.refund === 'other') : []
  if (other.length) {
    const rc = [...refundCatIds()][0]
    rows.push({ id: 'refunds', catId: rc, refunds: true, label: 'Reintegros', emoji: '↩️', color: NEUTRAL, value: other.reduce((s, e) => s + val(e), 0), count: other.length })
  }
  const nMovs = kind === 'expense' ? expE.filter((e) => !e.refund).length : incE.length
  const maxRow = Math.max(1, ...rows.map((r) => r.value))

  return (
    <main class="screen">
      <header class="top">
        <Seg value={kind} onChange={(v) => setKind(v)} options={[{ value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }]} />
        <div class="unit-seg"><Seg small value={wantUsd ? 'USD' : 'ARS'} onChange={(v) => saveSettings({ homeUnit: v })} options={[{ value: 'ARS', label: '$' }, { value: 'USD', label: 'US$' }]} /></div>
      </header>
      {wantUsd && !S.fx && <p class="notice">Sin cotizaciones guardadas todavía: se muestra en pesos. Abrí la app con internet una vez.</p>}
      {nPending > 0 && (
        <button class="pending-banner" onClick={openPending}>
          <span><b>{nPending === 1 ? '1 movimiento sin categoría' : `${nPending} movimientos sin categoría`}</b>. Tocá para categorizarlos.</span>
          <Icon name="right" size={18} />
        </button>
      )}
      {alerts.length > 0 && (
        <button class="pending-banner card-banner" onClick={openCards}>
          <span>{alerts.map((a) => <span class="cb-line">💳 <b>{a.text}</b></span>)}</span>
          <Icon name="right" size={18} />
        </button>
      )}
      {nDupes > 0 && (
        <button class="pending-banner dupe-banner" onClick={openDupes}>
          <span><b>{nDupes === 1 ? '1 posible duplicado' : `${nDupes} posibles duplicados`}</b>. Revisalos para que no se cuenten dos veces.</span>
          <Icon name="right" size={18} />
        </button>
      )}
      {debts?.total > 0 && (
        <button class="fut-link debt-link" onClick={openDebts}>
          <span>🤝 <b>Te deben <span class="num">{ars(debts.total, { decimals: false })}</span></b> · {debts.names.length <= 3 ? debts.names.join(', ') : `${debts.names.slice(0, 2).join(', ')} y ${debts.names.length - 2} más`}</span>
          <Icon name="right" size={18} />
        </button>
      )}
      {future && (
        <button class="fut-link" onClick={openFuture}>
          <span>🗓 <b>Pagos futuros</b>{future.total > 0 ? <> · falta pagar <b class="num">{ars(future.total, { decimals: false })}</b> este mes</> : ' · nada pendiente este mes'}</span>
          <Icon name="right" size={18} />
        </button>
      )}
      <PeriodBar period={period} setPeriod={setPeriod} />

      {rows.length === 0 ? (
        <Empty title={kind === 'expense' ? 'No hay gastos en este período' : 'No hay ingresos en este período'}>
          <button class="btn primary" onClick={() => onAdd(kind)}>{kind === 'expense' ? 'Cargar un gasto' : 'Cargar un ingreso'}</button>
        </Empty>
      ) : (
        <>
          <section class="home-total">
            <span class="ht-label">{kind === 'expense' ? 'Gastado' : 'Ingresado'}</span>
            <b class="ht-val num">{money(total, { decimals: false })}</b>
            <span class="ht-sub">{nMovs} movimientos{kind === 'expense' && other.length ? ' · neto de reintegros' : kind === 'income' ? ' · sin reintegros' : ''}</span>
          </section>
          <div class="stats3 stats2">
            {kind === 'expense'
              ? <div><span>Ingresos</span><b class="num pos">{money(inc, { decimals: false })}</b></div>
              : <div><span>Gastos</span><b class="num">{money(exp, { decimals: false })}</b></div>}
            <div><span>Balance</span><b class={`num ${inc - exp >= 0 ? 'pos' : 'neg'}`}>{money(inc - exp, { decimals: false, sign: inc - exp < 0 ? '−' : '' })}</b></div>
          </div>
          {usd && <p class="fine pad-x unit-note">En dólares: lo que cargaste en USD va con su monto exacto; el resto, al dólar {rateName} promedio de cada mes.</p>}
          <ul class="cat-list">
            {rows.map((r) => (
              <li>
                <button class={`cat-row${r.catId || r.refunds ? '' : ' uncat'}${r.refunds ? ' refund-row' : ''}`} onClick={() => openCategory(r.catId, r.refunds ? 'income' : kind)}>
                  <span class="dot" style={{ background: r.color }} />
                  <span class="cr-emoji" aria-hidden="true">{r.emoji}</span>
                  <span class="cr-name">{r.label}<small>{r.count} {r.count === 1 ? 'movimiento' : 'movimientos'}</small>
                    {!r.refunds && r.value > 0 && <i class="cr-bar" style={{ width: `${Math.max(2, (r.value / maxRow) * 100)}%`, background: r.color }} />}</span>
                  <span class="cr-pct">{r.refunds || total <= 0 ? '' : `${Math.round((r.value / total) * 100)}%`}</span>
                  <span class="cr-val num">{money(r.value, { decimals: false, sign: r.value < 0 ? '−' : '' })}</span>
                </button>
              </li>
            ))}
          </ul>
          {kind === 'income' && <p class="fine pad-x">Los reintegros (Cashback, lo que te devuelven por gastos compartidos) no figuran como ingreso: se restan de los gastos.</p>}
        </>
      )}
    </main>
  )
}
