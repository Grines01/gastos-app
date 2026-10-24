import { useEffect, useState } from 'preact/hooks'
import { S, put, remove, saveSettings, catById, defaultAccountId, today } from './lib/store.js'
import { money as money0, parseAmount, monthName, monthShort } from './lib/format.js'
import { occurrences, expectedAmount, findPayment, suggest, dateIn, words } from './lib/recurring.js'
import { nextDates } from './lib/cards.js'
import { StackBars, Legend } from './charts.jsx'
import { Icon, Seg, Sheet, toast, confirmDialog } from './ui.jsx'

const money = (c) => money0(c, { decimals: false })
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv') }
const methodText = (r) => (r.method === 'card' ? S.cards.find((c) => c.id === r.cardId)?.name || 'Tarjeta' : S.accounts.find((a) => a.id === r.accountId)?.name || 'Débito de cuenta')
const usdText = (c) => `US$ ${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`

// Estado de cada pago automático en un rango de fechas
export function recurringItems(from, to) {
  const out = []
  for (const r of S.recurring) {
    for (const date of occurrences(r, from, to)) {
      const paid = findPayment(r, date, S.txs)
      out.push({ r, date, paid, amount: paid ? paid.amount : expectedAmount(r, date, S.fx) })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}

// Lo que falta pagar este mes (cuotas futuras + automáticos sin pagar), para Inicio
export function pendingThisMonth() {
  const t0 = today(), end = dateIn(+t0.slice(0, 4), +t0.slice(5, 7), 31)
  const rec = recurringItems(t0.slice(0, 8) + '01', end).filter((x) => !x.paid)
  const inst = S.txs.filter((t) => t.installment && t.date > t0 && t.date <= end)
  return { total: rec.reduce((s, x) => s + x.amount, 0) + inst.reduce((s, t) => s + t.amount, 0), n: rec.length + inst.length }
}

// ---------- Proyección única (Resumen y Pagos futuros usan la misma) ----------
// Por mes: cuotas por tarjeta + pagos automáticos + otros fijos (estimado).
// "Otros fijos" = gastos con etiqueta Fijo del último mes completo que no son cuotas ni pagos automáticos
// (gimnasio, expensas, inglés…). Así nada se cuenta dos veces.
const isFijo = (t) => (t.tagIds || []).some((id) => S.tags.find((x) => x.id === id)?.name.toLowerCase() === 'fijo')
const isAuto = (t) => !!t.recurringId || S.recurring.some((r) => r.key && words(t).includes(r.key))
export function projection(nMonths = 6) {
  const t0 = today(), y = +t0.slice(0, 4), m = +t0.slice(5, 7)
  const exp = S.txs.filter((t) => t.type === 'expense')
  const last = dateIn(y, m - 1, 1).slice(0, 7)
  const otherFixed = (k) => exp.filter((t) => t.date.startsWith(k) && isFijo(t) && !t.installment && !isAuto(t))
  const otrosEst = otherFixed(last).reduce((s, t) => s + t.amount, 0)
  const otrosPaidNow = otherFixed(t0.slice(0, 7)).filter((t) => t.date <= t0).reduce((s, t) => s + t.amount, 0)
  const cards = S.cards.filter((c) => exp.some((t) => t.installment?.cardId === c.id && t.date > t0))
  const noCard = exp.some((t) => t.installment && t.date > t0 && !S.cards.some((c) => c.id === t.installment.cardId))
  const series = [
    ...cards.map((c, i) => ({ key: c.id, short: c.name, label: `Cuotas ${c.name}`, color: `var(--cc-${Math.min(i, 2) + 1})` })),
    ...(noCard ? [{ key: 'none', short: 'Sin tarjeta', label: 'Cuotas sin tarjeta', color: 'var(--cc-4)' }] : []),
    { key: 'auto', short: 'Automáticos', label: 'Pagos automáticos', color: 'var(--cc-auto)' },
    { key: 'otros', short: 'Otros fijos', label: 'Otros fijos (estimado)', color: 'var(--cc-none)' },
  ]
  const rows = Array.from({ length: nMonths }, (_, i) => {
    const from = dateIn(y, m + i, 1), to = dateIn(y, m + i, 31), d = new Date(y, m - 1 + i, 1)
    const row = { k: from.slice(0, 7), label: cap(monthShort(d.getMonth())), full: `${cap(monthName(d.getMonth()))} ${d.getFullYear()}${i === 0 ? ' (lo que falta)' : ''}` }
    for (const t of exp) if (t.installment && t.date > t0 && t.date >= from && t.date <= to) { const kk = S.cards.some((c) => c.id === t.installment.cardId) ? t.installment.cardId : 'none'; row[kk] = (row[kk] || 0) + t.amount }
    row.auto = recurringItems(from, to).filter((x) => !x.paid && (i > 0 || x.date >= t0.slice(0, 8) + '01')).reduce((s, x) => s + x.amount, 0)
    row.otros = i === 0 ? Math.max(0, otrosEst - otrosPaidNow) : otrosEst
    row.cuotas = series.filter((sr) => sr.key !== 'auto' && sr.key !== 'otros').reduce((s, sr) => s + (row[sr.key] || 0), 0)
    row.total = row.cuotas + row.auto + row.otros
    return row
  })
  return { rows, series: series.filter((sr) => rows.some((r) => r[sr.key] > 0)), lastLabel: cap(monthName(+last.slice(5, 7) - 1)) }
}

// Compras en cuotas con cuotas por pagar
export function activeInstallments() {
  const t0 = today(), groups = new Map()
  for (const t of S.txs) if (t.installment) { const g = groups.get(t.installment.group) || []; g.push(t); groups.set(t.installment.group, g) }
  return [...groups.values()].map((g) => {
    const left = g.filter((t) => t.date > t0).sort((a, b) => (a.date < b.date ? -1 : 1))
    if (!left.length) return null
    const i0 = g[0].installment
    return { name: (g[0].note || '').replace(/\s*\(cuota \d+\/\d+\)$/, ''), card: S.cards.find((c) => c.id === i0.cardId)?.name || 'Sin tarjeta', paid: i0.n - left.length, n: i0.n, each: left[0].amount, rest: left.reduce((s, t) => s + t.amount, 0), last: left.at(-1).date }
  }).filter(Boolean).sort((a, b) => (a.last < b.last ? -1 : 1))
}

// Qué compone cada color de la proyección en un mes (para la hoja de detalle)
export function seriesDetail(key, k) {
  const t0 = today(), y = +k.slice(0, 4), m = +k.slice(5, 7)
  const from = dateIn(y, m, 1), to = dateIn(y, m, 31), cur = k === t0.slice(0, 7)
  const exp = S.txs.filter((t) => t.type === 'expense')
  if (key === 'auto') {
    return {
      items: recurringItems(from, to).filter((x) => !x.paid).map((x) => ({ name: x.r.name, sub: `${x.date < t0 ? 'Tocaba' : 'Toca'} el ${ddmm(x.date)} · ${methodText(x.r)}`, amount: x.amount })),
      note: cur ? 'Solo los que todavía no figuran pagados este mes.' : 'Suscripciones y débitos automáticos que cargaste en Pagos futuros.',
    }
  }
  if (key === 'otros') {
    const lastK = dateIn(+t0.slice(0, 4), +t0.slice(5, 7) - 1, 1).slice(0, 7)
    const items = exp.filter((t) => t.date.startsWith(lastK) && isFijo(t) && !t.installment && !isAuto(t)).sort((a, b) => b.amount - a.amount)
      .map((t) => ({ name: t.note || catById(t.categoryId)?.name || 'Sin categoría', sub: `${ddmm(t.date)} · ${catById(t.categoryId)?.name || 'Sin categoría'}`, amount: t.amount, tx: t }))
    const paidNow = cur ? exp.filter((t) => t.date.startsWith(k) && t.date <= t0 && isFijo(t) && !t.installment && !isAuto(t)).reduce((s, t) => s + t.amount, 0) : 0
    const lm = monthName(+lastK.slice(5, 7) - 1)
    return { items, note: `Estimado con los gastos con etiqueta Fijo de ${lm} (sin cuotas ni pagos automáticos).${paidNow ? ` Este mes ya pagaste ${money(paidNow)} de esto.` : ''}`, listTitle: `Fijos de ${lm}` }
  }
  const inCard = (t) => (key === 'none' ? !S.cards.some((c) => c.id === t.installment.cardId) : t.installment.cardId === key)
  return {
    items: exp.filter((t) => t.installment && t.date > t0 && t.date >= from && t.date <= to && inCard(t)).sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((t) => ({ name: (t.note || '').replace(/\s*\(cuota \d+\/\d+\)$/, '') || 'Compra en cuotas', sub: `Cuota ${t.installment.k}/${t.installment.n} · vence el ${ddmm(t.date)}`, amount: t.amount, tx: t })),
  }
}

function DetailSheet({ pick, rows, series, onClose, onEdit, onOpen }) {
  if (!pick) return null
  const sr = series.find((x) => x.key === pick.key), row = rows.find((r) => r.k === pick.k)
  if (!sr || !row) return null
  const d = seriesDetail(pick.key, pick.k)
  const go = (fn) => { onClose(); fn() }
  return (
    <Sheet open title={sr.label.replace(' (estimado)', '')} onClose={onClose}>
      <div class="det">
        <p class="det-head"><i style={{ background: sr.color }} />{row.full}: <b class="num">{money(row[pick.key] || 0)}</b></p>
        {d.listTitle && <h3 class="sub-h">{d.listTitle}</h3>}
        {d.items.length === 0 ? <p class="fine">Nada para este mes.</p> : (
          <ul class="det-list">
            {d.items.map((it) => {
              const body = <><span>{it.name}<small>{it.sub}</small></span><b class="num">{money(it.amount)}</b></>
              return <li>{it.tx && onEdit ? <button onClick={() => go(() => onEdit(it.tx))}>{body}<Icon name="right" size={16} /></button> : <div>{body}</div>}</li>
            })}
          </ul>
        )}
        {d.note && <p class="fine">{d.note}</p>}
        {pick.key === 'auto' && onOpen && <button class="btn ghost wide" onClick={() => go(onOpen)}>Ver pagos automáticos</button>}
      </div>
    </Sheet>
  )
}

// Tarjeta de proyección (gráfico + cuotas activas + tabla plegable), compartida.
// Tocar un color (en el gráfico, la leyenda o el globo) abre qué lo compone.
export function ProjectionCard({ onOpen, onEdit, months = 6 }) {
  const [pick, setPick] = useState(null)
  const [sel, setSel] = useState(null)
  const { rows, series, lastLabel } = projection(months)
  const inst = activeInstallments()
  const next = rows[1]
  if (!rows.some((r) => r.total > 0)) return null
  // desde la leyenda: el mes elegido en el gráfico o, si no hay, el próximo mes que tenga ese color
  const fromLegend = (key) => { const r = (sel != null && rows[sel][key] > 0 ? rows[sel] : null) || rows.slice(1).find((x) => x[key] > 0) || rows[0]; setPick({ key, k: r.k }) }
  return (
    <section class="card proj">
      <div class="card-head"><h2>Próximos meses</h2>{onOpen && <button class="link-btn" onClick={onOpen}>Ver detalle</button>}</div>
      <p class="proj-head">{next.full}: <b class="num">{money(next.total)}</b> comprometido{next.cuotas && next.cuotas !== next.total ? <>, <span class="num">{money(next.cuotas)}</span> en cuotas</> : null}</p>
      <Legend items={series.map((sr) => ({ label: sr.short, color: sr.color, onClick: () => fromLegend(sr.key) }))} />
      <StackBars data={rows} series={series} fmt={(v) => money(v)} onSel={setSel} onPick={(key, i) => setPick({ key, k: rows[i].k })} />
      <p class="fine proj-hint">Tocá un color para ver qué incluye.</p>
      {inst.length > 0 && (
        <>
          <h3 class="sub-h">Cuotas activas</h3>
          <ul class="inst-list compact">
            {inst.map((a) => (
              <li><span>{a.name}<small>{a.card} · {a.paid}/{a.n} pagadas · termina en {monthShort(+a.last.slice(5, 7) - 1)}</small></span><b class="num">{money(a.each)}</b></li>
            ))}
          </ul>
        </>
      )}
      <details class="proj-table">
        <summary>Ver en tabla</summary>
        <div class="fx-table" role="table">
          <div class="fx-row fx-h" role="row"><span>Mes</span><span>Cuotas</span><span>Fijos</span><span>Total</span></div>
          {rows.map((r) => <div class="fx-row" role="row"><span>{r.label} {r.k.slice(2, 4)}</span><span class="num">{r.cuotas ? money(r.cuotas) : '—'}</span><span class="num">{money(r.auto + r.otros)}</span><b class="num">{money(r.total)}</b></div>)}
        </div>
        <p class="fine">Fijos = pagos automáticos + otros gastos con etiqueta Fijo (estimados con {lastLabel}). El mes actual muestra solo lo que falta.</p>
      </details>
      <DetailSheet pick={pick} rows={rows} series={series} onClose={() => setPick(null)} onEdit={onEdit} onOpen={onOpen} />
    </section>
  )
}

export function FuturePage({ onConfirm }) {
  const [edit, setEdit] = useState(null)
  const t0 = today()
  const y = +t0.slice(0, 4), m = +t0.slice(5, 7)
  const monthStart = dateIn(y, m, 1), monthEnd = dateIn(y, m, 31)
  const in30 = addDays(t0, 30)

  // --- este mes
  const month = recurringItems(monthStart, monthEnd)
  const paidN = month.filter((x) => x.paid).length
  const instLeft = S.txs.filter((t) => t.installment && t.date > t0 && t.date <= monthEnd)
  const left = month.filter((x) => !x.paid).reduce((s, x) => s + x.amount, 0) + instLeft.reduce((s, t) => s + t.amount, 0)

  // --- próximos 30 días: automáticos sin pagar, cuotas y vencimientos de tarjeta
  const upcoming = [
    ...recurringItems(addDays(t0, -5), in30).filter((x) => !x.paid).map((x) => ({ kind: 'rec', date: x.date, name: x.r.name, sub: methodText(x.r), amount: x.amount, x })),
    ...S.txs.filter((t) => t.installment && t.date > t0 && t.date <= in30).map((t) => ({ kind: 'inst', date: t.date, name: t.note, sub: S.cards.find((c) => c.id === t.installment.cardId)?.name || 'Sin tarjeta', amount: t.amount })),
    ...S.cards.flatMap((c) => { const d = nextDates(c, t0).due; return d <= in30 ? [{ kind: 'due', date: d, name: `Vence ${c.name}`, sub: 'Resumen de la tarjeta', amount: null }] : [] }),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'due' ? 1 : -1))

  const sugg = suggest(S.txs, S.recurring, S.settings.recDismissed || [], t0).slice(0, 8)
  const dismiss = (k) => saveSettings({ recDismissed: [...(S.settings.recDismissed || []), k] })
  const confirm = (x) => onConfirm({
    type: 'expense', date: x.date > t0 ? t0 : x.date, amount: x.amount, categoryId: x.r.categoryId, note: x.r.name,
    tagIds: [S.tags.find((t) => t.name.toLowerCase() === 'fijo')?.id].filter(Boolean),
    currency: x.r.currency === 'USD' ? 'USD' : 'ARS', origAmount: x.r.currency === 'USD' ? x.r.origAmount : null, rate: null,
    accountId: (x.r.method === 'account' && x.r.accountId) || defaultAccountId(), recurringId: x.r.id,
  })

  return (
    <>
      <div class="tiles fut-tiles">
        <div class="tile"><span class="tile-l">Falta pagar este mes</span><b class="tile-v num">{money(left)}</b><span class="tile-s">Cuotas y pagos automáticos</span></div>
        <div class="tile"><span class="tile-l">Automáticos de {monthName(m - 1)}</span><b class="tile-v num">{S.recurring.length ? `${paidN} de ${month.length}` : '—'}</b><span class="tile-s">{S.recurring.length ? 'ya pagados' : 'Todavía no cargaste ninguno'}</span></div>
      </div>

      <section class="card">
        <h2>Próximos 30 días</h2>
        {upcoming.length === 0 ? <p class="fine">Nada programado por ahora.</p> : (
          <ul class="fut-list">
            {upcoming.map((u) => (
              <li class={`fut-${u.kind}${u.date < t0 ? ' late' : ''}`}>
                <span class="fut-date"><b>{u.date.slice(8)}</b><small>{monthShort(+u.date.slice(5, 7) - 1)}</small></span>
                <span class="fut-main"><span>{u.name}</span><small>{u.date < t0 ? 'Todavía no figura pagado · ' : ''}{u.sub}</small></span>
                <span class="fut-amt">{u.amount != null && <b class="num">{money(u.amount)}</b>}{u.kind === 'rec' && <button class="link-btn inline" onClick={() => confirm(u.x)}>Ya lo pagué</button>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="card">
        <h2>Pagos automáticos de {monthName(m - 1)}</h2>
        {month.length === 0 ? <p class="fine">Cargá tus suscripciones y débitos automáticos abajo para ver acá cuáles ya se pagaron.</p> : (
          <ul class="fut-check">
            {month.map((x) => (
              <li class={x.paid ? 'ok' : ''}>
                <span class="fc-mark" aria-hidden="true">{x.paid ? '✓' : '○'}</span>
                <span class="fut-main"><span>{x.r.name}</span><small>{x.paid ? `Pagado el ${ddmm(x.paid.date)}` : `${x.date < t0 ? 'Tocaba' : 'Toca'} el ${ddmm(x.date)}`} · {methodText(x.r)}</small></span>
                <span class="fut-amt"><b class="num">{money(x.amount)}</b>{!x.paid && <button class="link-btn inline" onClick={() => confirm(x)}>Ya lo pagué</button>}</span>
              </li>
            ))}
          </ul>
        )}
        <p class="fine">Se marca solo cuando cargás o importás el cobro (por el nombre y un monto parecido). "Ya lo pagué" lo carga con el monto sugerido, que podés corregir.</p>
      </section>

      <ProjectionCard onEdit={onConfirm} />

      <section class="card">
        <div class="card-head"><h2>Tus pagos automáticos</h2><button class="link-btn" onClick={() => setEdit(blank())}>Agregar</button></div>
        {S.recurring.length === 0 ? <p class="fine">Suscripciones (Claude, Audible) y débitos automáticos (Internet). Lo que pagás a mano no va acá.</p> : (
          <ul class="fut-check">
            {[...S.recurring].sort((a, b) => a.day - b.day).map((r) => (
              <li><button class="rec-row" onClick={() => setEdit(r)}>
                <span class="fut-main"><span>{r.name}</span><small>{r.freq === 'yearly' ? `Anual, ${r.day} de ${monthName(r.month - 1)}` : `Día ${r.day}`} · {methodText(r)}</small></span>
                <span class="fut-amt"><b class="num">{r.currency === 'USD' ? usdText(r.origAmount) : money(r.amount)}</b></span>
              </button></li>
            ))}
          </ul>
        )}
        {sugg.length > 0 && (
          <>
            <h3 class="sub-h">Encontré en tus gastos</h3>
            <p class="fine">Se repiten todos los meses. Agregá solo los que se cobran solos.</p>
            <ul class="fut-check">
              {sugg.map((s) => (
                <li class="sugg">
                  <span class="fut-main"><span>{s.name}</span><small>{s.n} meses · último el {ddmm(s.lastDate)} · {catById(s.categoryId)?.name || ''}</small></span>
                  <span class="sugg-btns">
                    <button class="btn ghost sm" onClick={() => dismiss(s.key)} aria-label={`Descartar ${s.name}`}>No</button>
                    <button class="btn primary sm" onClick={() => setEdit({ ...blank(), name: s.name, key: s.key, amount: s.amount, currency: s.currency, origAmount: s.origAmount, rate: s.rate, categoryId: s.categoryId, day: s.day })}>Agregar</button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <RecurringSheet r={edit} onClose={() => setEdit(null)} />
    </>
  )
}

const blank = () => ({ name: '', key: '', amount: 0, currency: 'ARS', origAmount: null, categoryId: S.categories.find((c) => c.kind === 'expense' && /subscrip|suscrip/i.test(c.name))?.id || null, freq: 'monthly', day: Number(today().slice(8)), month: Number(today().slice(5, 7)), method: S.cards.length ? 'card' : 'account', cardId: S.cards[0]?.id || null, accountId: defaultAccountId() })

function RecurringSheet({ r, onClose }) {
  const [v, setV] = useState(null)
  const [amt, setAmt] = useState('')
  useEffect(() => {
    if (!r) return setV(null)
    setV({ ...r, day: String(r.day) })
    const c = r.currency === 'USD' ? r.origAmount : r.amount
    setAmt(c ? (c / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '')
  }, [r])
  if (!r || !v) return null
  const usd = v.currency === 'USD'
  const cats = S.categories.filter((c) => c.kind === 'expense' && !c.archived)
  const save = async () => {
    const cents = parseAmount(amt), day = Number(v.day)
    if (!v.name.trim()) return toast('Poné un nombre')
    if (!(cents > 0)) return toast('Escribí el monto aproximado')
    if (!(day >= 1 && day <= 31)) return toast('El día va del 1 al 31')
    if (v.method === 'card' && !v.cardId) return toast('Elegí la tarjeta, o cargala en Más → Tarjetas')
    const key = (v.key || v.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3)[0] || ''
    const obj = { ...v, name: v.name.trim(), key, day, month: Number(v.month) || 1, start: v.start || today().slice(0, 7),
      amount: usd ? Math.round(cents * (S.fx ? Object.values(S.fx).at(-1) : v.rate || 0)) || v.amount || 0 : cents, origAmount: usd ? cents : null }
    if (usd && !obj.rate && S.fx) obj.rate = Object.values(S.fx).at(-1)
    await put('recurring', obj); onClose(); toast(r.id ? 'Pago automático actualizado' : 'Pago automático agregado')
  }
  const del = async () => { if (confirmDialog('¿Eliminar este pago automático? Los gastos ya cargados no se tocan.')) { await remove('recurring', r.id); onClose(); toast('Eliminado') } }
  return (
    <Sheet open title={r.id ? 'Editar pago automático' : 'Nuevo pago automático'} onClose={onClose}>
      <div class="form">
        <label class="sel"><span>Nombre</span><input value={v.name} placeholder="Ej: Claude, Internet" onInput={(e) => setV({ ...v, name: e.currentTarget.value })} /></label>
        <label class="sel amount-sel"><span>Monto aproximado</span>
          <span class="affix"><button type="button" class="cur-mini" onClick={(e) => { e.preventDefault(); setV({ ...v, currency: usd ? 'ARS' : 'USD' }) }} aria-label="Cambiar moneda">{usd ? 'US$' : '$'}</button>
            <input inputmode="decimal" value={amt} placeholder={usd ? '20' : '30.000'} onInput={(e) => setAmt(e.currentTarget.value)} /></span>
        </label>
        <label class="sel"><span>Categoría</span><select value={v.categoryId || ''} onChange={(e) => setV({ ...v, categoryId: e.currentTarget.value })}>{cats.map((c) => <option value={c.id}>{c.emoji} {c.name}</option>)}</select></label>
        <span class="lbl">Cada cuánto</span>
        <Seg small value={v.freq} onChange={(f) => setV({ ...v, freq: f })} options={[{ value: 'monthly', label: 'Todos los meses' }, { value: 'yearly', label: 'Una vez al año' }]} />
        <div class="field-row two" style={{ paddingTop: 0 }}>
          <label class="sel"><span>Día</span><input inputmode="numeric" value={v.day} onInput={(e) => setV({ ...v, day: e.currentTarget.value.replace(/\D/g, '') })} /></label>
          {v.freq === 'yearly' && <label class="sel"><span>Mes</span><select value={v.month} onChange={(e) => setV({ ...v, month: Number(e.currentTarget.value) })}>{Array.from({ length: 12 }, (_, i) => <option value={i + 1}>{cap(monthName(i))}</option>)}</select></label>}
        </div>
        <span class="lbl">Cómo se cobra</span>
        <Seg small value={v.method} onChange={(mm) => setV({ ...v, method: mm })} options={[{ value: 'card', label: 'Tarjeta de crédito' }, { value: 'account', label: 'Débito de cuenta' }]} />
        {v.method === 'card'
          ? (S.cards.length ? <label class="sel"><span>Tarjeta</span><select value={v.cardId || ''} onChange={(e) => setV({ ...v, cardId: e.currentTarget.value })}>{S.cards.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
            : <p class="fine">Primero cargá la tarjeta en Más → Tarjetas.</p>)
          : <label class="sel"><span>Cuenta</span><select value={v.accountId || ''} onChange={(e) => setV({ ...v, accountId: e.currentTarget.value })}>{S.accounts.filter((a) => !a.archived).map((a) => <option value={a.id}>{a.name}</option>)}</select></label>}
        <label class="sel"><span>Se reconoce por</span><input value={v.key || ''} placeholder={v.name.toLowerCase() || 'palabra del cobro'} onInput={(e) => setV({ ...v, key: e.currentTarget.value })} /></label>
        <p class="fine">Una palabra que aparece en la descripción del cobro (ej. "personal" para Internet). Así se marca solo como pagado.</p>
        {r.id && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Eliminar</button>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}
