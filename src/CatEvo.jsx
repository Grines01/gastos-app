import { useState } from 'preact/hooks'
import { S, catById, saveSettings, today } from './lib/store.js'
import { money as money0, monthName, monthShort, pad, toUsd } from './lib/format.js'
import { spendEntries } from './lib/metrics.js'
import { Bars } from './charts.jsx'
import { Seg } from './ui.jsx'

// Evolución mes a mes de una categoría (y, opcional, de lo que dice la descripción: "gym, gim").
// Barras mensuales + promedio: responde "¿cuánto gasto por mes en X y cómo viene cambiando?".
const money = (c) => money0(c, { decimals: false })
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const key = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const STOP = new Set(['para', 'con', 'del', 'las', 'los', 'una', 'por', 'compra', 'pago', 'cuota', 'transferencia', 'inmediata', 'varios', 'debito', 'tarjeta'])
const terms = (q) => norm(q).split(',').map((x) => x.trim()).filter(Boolean)
const textOf = (t) => norm(`${t.note || ''} ${t.rawDesc || ''}`)

export function CatEvolution({ y, m, fx, openMovs }) {
  const cfg = S.settings.catEvo || {}
  const [unit, setUnit] = useState('ARS')
  const [q, setQ] = useState(cfg.q || '')
  const t0 = today()
  const all = spendEntries()
  // categorías con gastos en los últimos 12 meses, de mayor a menor
  const since = key(y, m - 11)
  const totals = new Map()
  for (const e of all) if (e.categoryId && e.date.slice(0, 7) >= since && e.amount > 0) totals.set(e.categoryId, (totals.get(e.categoryId) || 0) + e.amount)
  const cats = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => catById(id)).filter(Boolean)
  if (!cats.length) return null
  const catId = cats.some((c) => c.id === cfg.cat) ? cfg.cat : cats[0].id
  const setCat = (id) => { setQ(''); saveSettings({ catEvo: { cat: id, q: '' } }) }
  const setText = (v) => { setQ(v); saveSettings({ catEvo: { cat: catId, q: v } }) }

  const ts = terms(q)
  const inCat = all.filter((e) => e.categoryId === catId && (!ts.length || (!e.refund && ts.some((w) => textOf(e.t).includes(w)))))
  const inUsd = unit === 'USD' && !!fx
  const val = (e) => (inUsd ? (Math.sign(e.amount) || 1) * (toUsd(e.t, fx) || 0) : e.amount)
  const fmt = (v) => (inUsd ? `US$ ${Math.round(v / 100).toLocaleString('es-AR')}` : money(v))

  const rows = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(y, m - i, 1), k = key(d.getFullYear(), d.getMonth())
    const list = inCat.filter((e) => e.date.startsWith(k))
    if (!rows.length && !S.txs.some((t) => t.date.startsWith(k))) continue
    rows.push({ k, label: cap(monthShort(d.getMonth())), full: `${cap(monthName(d.getMonth()))} ${d.getFullYear()}`, v: list.reduce((s, e) => s + val(e), 0), n: list.filter((e) => !e.refund).length, dim: k === t0.slice(0, 7) })
  }
  // meses completos; con filtro de texto (un precio: gimnasio, cuota) se miran solo los meses con pago
  const full = rows.filter((r) => !r.dim && (!ts.length || r.v > 0))
  const avg = full.length ? full.reduce((s, r) => s + r.v, 0) / full.length : 0
  const last = full.at(-1), prev = full.at(-2)
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)
  const vsPrev = last && prev ? pct(last.v, prev.v) : null
  const first = full.find((r) => r.v > 0)
  const vsFirst = last && first && first !== last ? pct(last.v, first.v) : null

  // palabras frecuentes de la categoría, para filtrar con un toque (ej. Gym, Running, Peluquería)
  const words = new Map()
  for (const e of all) {
    if (e.categoryId !== catId || e.refund || e.date.slice(0, 7) < since) continue
    for (const w of new Set(norm(e.t.note).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/\d/.test(w)))) {
      const s = words.get(w) || new Set(); s.add(e.date.slice(0, 7)); words.set(w, s)
    }
  }
  const chips = [...words.entries()].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 6).map(([w]) => w)
  const c = catById(catId)

  return (
    <section class="card cat-evo">
      <div class="card-head"><h2>Evolución por categoría</h2>
        {fx && <Seg small value={unit} onChange={setUnit} options={[{ value: 'ARS', label: '$' }, { value: 'USD', label: 'US$' }]} />}
      </div>
      <div class="ce-pick">
        <label class="sel"><span>Categoría</span>
          <select value={catId} onChange={(e) => setCat(e.currentTarget.value)}>{cats.map((x) => <option value={x.id}>{x.emoji || ''} {x.name}</option>)}</select>
        </label>
        <label class="sel"><span>Que diga (opcional)</span>
          <input value={q} placeholder="Ej: gym, gim" onInput={(e) => setText(e.currentTarget.value)} />
        </label>
      </div>
      {chips.length > 0 && (
        <div class="chips wrap ce-chips">
          {chips.map((w) => <button class={`chip${ts.length === 1 && ts[0] === w ? ' on' : ''}`} onClick={() => setText(ts.length === 1 && ts[0] === w ? '' : w)}>{cap(w)}</button>)}
        </div>
      )}
      {!full.some((r) => r.v > 0) && !rows.some((r) => r.v > 0) ? <p class="fine">No hay gastos {q ? `que digan "${q}" ` : ''}en {c?.name} en los últimos 12 meses.</p> : (
        <>
          <p class="ce-head">
            Promedio <b class="num">{fmt(avg)}</b> {ts.length ? 'por pago' : 'por mes'}
            {last && <> · {last.label.toLowerCase()} <b class="num">{fmt(last.v)}</b>{vsPrev != null && <span class={vsPrev > 0 ? 'neg' : vsPrev < 0 ? 'pos' : ''}> ({vsPrev > 0 ? '+' : ''}{vsPrev}% vs {prev.label.toLowerCase()})</span>}</>}
          </p>
          <Bars data={rows} series={[{ key: 'v', label: q ? `${c?.name} · "${q}"` : c?.name, color: c?.color || 'var(--series-2)' }]} fmt={fmt} avg={avg} avgLabel="promedio"
            extra={(d) => <span class="tip-wide">{d.n} {d.n === 1 ? 'movimiento' : 'movimientos'}{d.dim ? ' · mes en curso' : ''} <button class="link-btn inline" onClick={() => openMovs(catId, d.k, q)}>Ver</button></span>} />
          <p class="fine">
            {vsFirst != null ? `De ${first.label.toLowerCase()} a ${last.label.toLowerCase()}: ${vsFirst > 0 ? '+' : ''}${vsFirst}%${inUsd ? ' en dólares' : ' en pesos'}. ` : ''}
            {inUsd ? 'En dólares se ve el aumento real, sin inflación.' : 'En pesos ves cuánto pagaste; pasá a US$ para verlo sin inflación.'} El mes en curso va más claro. Tocá un mes para ver sus movimientos.
          </p>
        </>
      )}
    </section>
  )
}
