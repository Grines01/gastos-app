import { useEffect, useState } from 'preact/hooks'
import { S, put, remove, saveSettings, catById, defaultAccountId, today } from './lib/store.js'
import { money as money0, parseAmount, monthName, monthShort } from './lib/format.js'
import { occurrences, expectedAmount, findPayment, suggest, dateIn } from './lib/recurring.js'
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

  // --- proyección: 6 meses desde este
  const SERIES = [{ key: 'inst', label: 'Cuotas', color: 'var(--cc-1)' }, { key: 'rec', label: 'Suscripciones y débitos', color: 'var(--cc-2)' }]
  const proj = Array.from({ length: 6 }, (_, i) => {
    const from = dateIn(y, m + i, 1), to = dateIn(y, m + i, 31)
    const d = new Date(y, m - 1 + i, 1)
    const rec = recurringItems(from, to).filter((x) => i > 0 || !x.paid)
    return {
      label: cap(monthShort(d.getMonth())), full: `${cap(monthName(d.getMonth()))} ${d.getFullYear()}${i === 0 ? ' (lo que falta)' : ''}`,
      inst: S.txs.filter((t) => t.installment && t.date > t0 && t.date >= from && t.date <= to).reduce((s, t) => s + t.amount, 0),
      rec: rec.reduce((s, x) => s + x.amount, 0),
    }
  })

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

      <section class="card">
        <h2>Próximos 6 meses</h2>
        <Legend items={SERIES} />
        <StackBars data={proj} series={SERIES} fmt={(v) => money(v)} />
        <p class="fine">Cuotas ya cargadas más tus pagos automáticos estimados. Los que son en dólares, al dólar promedio del último mes.</p>
      </section>

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
