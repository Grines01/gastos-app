import { useEffect, useState } from 'preact/hooks'
import { S, put, remove, saveSettings, bulkPut, today } from './lib/store.js'
import { parseAmount, uid } from './lib/format.js'
import { fetchRate } from './lib/rates.js'
import { wAccounts, goalMonths, summary, monthlySpendUsd, recordedSavingsUsd, parseWealthFile, inUsd } from './lib/wealth.js'
import { Lines } from './charts.jsx'
import { Icon, Sheet, Seg, toast, confirmDialog } from './ui.jsx'

const usd = (c, sign = false) => `${sign && c > 0 ? '+' : c < 0 ? '−' : ''}US$ ${Math.round(Math.abs(c) / 100).toLocaleString('es-AR')}`
const orig = (a, c) => `${a.currency === 'USD' ? 'US$' : '$'} ${(c / 100).toLocaleString('es-AR', { maximumFractionDigits: a.currency === 'USD' ? 2 : 0 })}`
const ddmmyy = (d) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
const fmtIn = (c) => (c == null ? '' : (c / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 }))

// Resumen (tarjeta chica) — patrimonio neto de la última foto
export function wealthHeadline() {
  const snaps = S.snapshots
  if (!snaps.length || !wAccounts().length) return null
  const last = snaps.at(-1), prev = snaps.at(-2)
  const s = summary(last)
  return { net: s.net, date: last.date, delta: prev ? s.net - summary(prev).net : null }
}

export function WealthPage() {
  const [snapEdit, setSnapEdit] = useState(null)
  const [accEdit, setAccEdit] = useState(null)
  const accs = wAccounts()
  const snaps = S.snapshots
  const last = snaps.at(-1), prev = snaps.at(-2)

  const loadFile = async (file) => {
    try {
      const d = parseWealthFile(JSON.parse(await file.text()))
      const cur = [...accs]
      for (const a of d.accounts) if (!cur.some((x) => x.id === a.id)) cur.push(a)
      await saveSettings({ wealth: { ...(S.settings.wealth || {}), accounts: cur } })
      const news = (d.snapshots || []).filter((sn) => !S.snapshots.some((x) => x.id === sn.id))
      if (news.length) await bulkPut('snapshots', news)
      toast(`${news.length} ${news.length === 1 ? 'foto cargada' : 'fotos cargadas'}`)
    } catch (e) { toast(e.message?.startsWith('No es') ? e.message : 'No pude leer el archivo') }
  }
  const picker = (label) => <label class="btn ghost file-btn">{label}<input type="file" accept=".json,application/json" onChange={(e) => e.currentTarget.files[0] && loadFile(e.currentTarget.files[0])} /></label>

  if (!accs.length) return (
    <>
      <p class="fine pad-x">Cada tanto (una vez por mes alcanza) sacás una foto de tus saldos reales: cuentas, inversiones y lo que debés de tarjeta. Así ves cuánto tenés en total, cómo crece en dólares y si se te escapa algo sin registrar.</p>
      <div class="pad-x wl-start">
        <button class="btn primary" onClick={() => setAccEdit({ name: '', currency: 'ARS', kind: 'asset', liquid: true })}>Agregar una cuenta</button>
        {picker('Cargar archivo de patrimonio')}
      </div>
      <AccSheet a={accEdit} onClose={() => setAccEdit(null)} />
    </>
  )

  const s = last && summary(last)
  const spend = monthlySpendUsd(last?.rate)
  const months = spend > 0 && s ? s.liquid / spend : null
  const goal = goalMonths()
  const series = snaps.map((x) => summary(x).net)
  const conc = prev ? { rec: recordedSavingsUsd(prev, last), real: s.net - summary(prev).net } : null

  return (
    <>
      {s ? (
        <div class="tiles fut-tiles">
          <div class="tile"><span class="tile-l">Patrimonio neto</span><b class="tile-v num">{usd(s.net)}</b>
            <span class="tile-s">{ddmmyy(last.date)}{prev ? ` · ${usd(s.net - summary(prev).net, true)} desde el ${ddmmyy(prev.date)}` : ''}</span></div>
          <div class="tile"><span class="tile-l">Fondo de emergencia</span><b class="tile-v num">{months != null ? `${months.toLocaleString('es-AR', { maximumFractionDigits: 1 })} meses` : '—'}</b>
            <span class="tile-s">{months != null ? `de ${goal} · ${usd(s.liquid)} disponibles` : 'Falta tu gasto mensual'}</span>
            {months != null && <i class="wl-bar"><i style={{ width: `${Math.min(100, (months / goal) * 100)}%` }} /></i>}</div>
        </div>
      ) : <p class="fine pad-x">Todavía no sacaste ninguna foto de tus saldos.</p>}

      <div class="pad-x wl-actions">
        <button class="btn primary" onClick={() => setSnapEdit({ date: today(), rate: last?.rate || null, values: { ...(last?.values || {}) } })}><Icon name="plus" size={18} /> Nueva foto</button>
      </div>

      {s && (
        <section class="card">
          <h2>Dónde está</h2>
          <ul class="wl-list">
            {[...s.rows].filter((r) => r.a.kind !== 'debt' || r.v > 0).sort((x, y) => (x.a.kind === y.a.kind ? y.u - x.u : x.a.kind === 'debt' ? 1 : -1)).map(({ a, v, u }) => (
              <li class={a.kind === 'debt' ? 'debt' : ''}>
                <button onClick={() => setAccEdit(a)}>
                  <span>{a.name}<small>{orig(a, v)}{a.kind === 'debt' ? ' · a pagar' : ` · ${a.liquid ? 'disponible' : 'invertido'}`}</small></span>
                  <b class="num">{a.kind === 'debt' ? '−' : ''}{usd(u).replace('−', '')}</b>
                  {a.kind !== 'debt' && <i class="wl-pct">{s.assets > 0 ? `${Math.round((u / s.assets) * 100)}%` : ''}</i>}
                </button>
              </li>
            ))}
          </ul>
          <p class="fine">Pesos pasados a dólar a {Math.round(last.rate).toLocaleString('es-AR')} ({ddmmyy(last.date)}). Tocá una cuenta para editarla. <button class="link-btn inline" onClick={() => setAccEdit({ name: '', currency: 'ARS', kind: 'asset', liquid: true })}>Agregar cuenta</button></p>
        </section>
      )}

      {conc && (
        <section class="card">
          <h2>¿Cuadra con lo que registraste?</h2>
          <p class="wl-conc">Del {ddmmyy(prev.date)} al {ddmmyy(last.date)}, la app registró un ahorro de <b class="num">{usd(conc.rec)}</b> y tu patrimonio cambió <b class="num">{usd(conc.real, true)}</b>.</p>
          {Math.abs(conc.real - conc.rec) < Math.max(5000, Math.abs(conc.rec) * 0.05)
            ? <p class="fine pos">Cuadra: lo que registrás coincide con tus saldos.</p>
            : <p class={`fine ${conc.real < conc.rec ? 'neg' : ''}`}>Diferencia de <b class="num">{usd(conc.real - conc.rec, true)}</b>. {conc.real < conc.rec ? 'Probablemente hay gastos sin registrar (o subió el dólar que usaste para los pesos).' : 'Puede ser rendimiento de inversiones, una suba del dólar o ingresos sin registrar.'}</p>}
        </section>
      )}

      {snaps.length >= 2 && (
        <section class="card">
          <h2>Evolución</h2>
          <Lines label="Patrimonio neto" days={snaps.length} fit series={[{ label: 'Patrimonio', color: 'var(--series-1)', values: series }]}
            tick={(v) => `${Math.round(v / 100000).toLocaleString('es-AR')} k`} xTick={(i) => ddmmyy(snaps[i].date).slice(0, 5)} xLabel={(d) => ddmmyy(snaps[d - 1].date)} fmt={(v) => usd(v)} />
        </section>
      )}

      <section class="card">
        <h2>Fotos</h2>
        {snaps.length === 0 ? <p class="fine">Sin fotos todavía.</p> : (
          <ul class="wl-list">
            {[...snaps].reverse().map((x) => <li><button onClick={() => setSnapEdit(x)}><span>{ddmmyy(x.date)}<small>dólar {Math.round(x.rate).toLocaleString('es-AR')}</small></span><b class="num">{usd(summary(x).net)}</b></button></li>)}
          </ul>
        )}
        <div class="wl-goal">
          <span class="fine">Meta del fondo de emergencia</span>
          <Seg small value={String(goal)} onChange={(v) => saveSettings({ wealth: { ...(S.settings.wealth || {}), goalMonths: Number(v) } })} options={[3, 4, 6, 9, 12].map((n) => ({ value: String(n), label: `${n} m` }))} />
        </div>
        <p class="fine">Disponible = cuentas marcadas como "disponible" (no inversiones). Meses = disponible ÷ tu gasto real promedio de los últimos 3 meses ({usd(spend)}).</p>
        <div class="wl-foot">{picker('Cargar archivo de patrimonio')}</div>
      </section>

      <SnapSheet snap={snapEdit} onClose={() => setSnapEdit(null)} />
      <AccSheet a={accEdit} onClose={() => setAccEdit(null)} />
    </>
  )
}

function SnapSheet({ snap, onClose }) {
  const [v, setV] = useState(null)
  const [rateState, setRateState] = useState('idle')
  useEffect(() => {
    if (!snap) return setV(null)
    setV({ ...snap, rateStr: snap.rate ? String(snap.rate).replace('.', ',') : '', vals: Object.fromEntries(wAccounts().map((a) => [a.id, fmtIn(snap.values?.[a.id])])) })
  }, [snap])
  useEffect(() => { // dólar MEP del día de la foto
    if (!v || v.id || v.rateStr) return
    let alive = true; setRateState('loading')
    fetchRate('bolsa', v.date, 'venta').then((r) => alive && (setV((o) => ({ ...o, rateStr: String(r).replace('.', ',') })), setRateState('ok'))).catch(() => alive && setRateState('error'))
    return () => { alive = false }
  }, [v?.date, !!v])
  if (!snap || !v) return null
  const accs = wAccounts()
  const save = async () => {
    const rate = parseAmount(v.rateStr) / 100
    if (!(rate > 0)) return toast('Poné la cotización del dólar')
    const values = {}
    for (const a of accs) { const c = parseAmount(v.vals[a.id]); if (Number.isFinite(c) && v.vals[a.id] !== '') values[a.id] = Math.abs(c) }
    if (!Object.keys(values).length) return toast('Cargá al menos un saldo')
    await put('snapshots', { id: snap.id || uid(), date: v.date, rate, values })
    onClose(); toast(snap.id ? 'Foto actualizada' : 'Foto guardada')
  }
  const del = async () => { if (!confirmDialog('¿Borrar esta foto?')) return; await remove('snapshots', snap.id); onClose() }
  return (
    <Sheet open title={snap.id ? 'Editar foto' : 'Nueva foto'} onClose={onClose}>
      <div class="form">
        <div class="field-row two" style={{ paddingTop: 0 }}>
          <label class="sel"><span>Fecha</span><input type="date" value={v.date} onInput={(e) => e.currentTarget.value && setV({ ...v, date: e.currentTarget.value, rateStr: v.id ? v.rateStr : '' })} /></label>
          <label class="sel"><span>Dólar MEP {rateState === 'loading' ? '(buscando…)' : ''}</span><input inputmode="decimal" value={v.rateStr} placeholder={rateState === 'error' ? 'Escribila' : '—'} onInput={(e) => setV({ ...v, rateStr: e.currentTarget.value })} /></label>
        </div>
        <p class="fine">Saldos de hoy. Vienen precargados con la foto anterior: cambiá solo lo que se movió.</p>
        {accs.map((a) => (
          <label class="sel wl-in"><span>{a.name}{a.kind === 'debt' ? ' (deuda)' : ''}</span>
            <span class="affix"><i>{a.currency === 'USD' ? 'US$' : '$'}</i><input inputmode="decimal" value={v.vals[a.id]} placeholder="0" onInput={(e) => setV({ ...v, vals: { ...v.vals, [a.id]: e.currentTarget.value } })} /></span>
          </label>
        ))}
        {snap.id && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Borrar foto</button>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}

function AccSheet({ a, onClose }) {
  const [v, setV] = useState(null)
  useEffect(() => { setV(a ? { ...a } : null) }, [a])
  if (!a || !v) return null
  const save = async () => {
    if (!v.name.trim()) return toast('Poné un nombre')
    const accs = wAccounts().filter((x) => x.id !== a.id)
    const o = { ...v, name: v.name.trim(), id: a.id || uid(), liquid: v.kind === 'debt' ? false : !!v.liquid }
    const i = wAccounts().findIndex((x) => x.id === a.id)
    const list = i >= 0 ? wAccounts().map((x) => (x.id === a.id ? o : x)) : [...accs, o]
    await saveSettings({ wealth: { ...(S.settings.wealth || {}), accounts: list } }); onClose()
  }
  const del = async () => {
    if (!confirmDialog('¿Quitar esta cuenta del patrimonio? Las fotos viejas la dejan de contar.')) return
    await saveSettings({ wealth: { ...(S.settings.wealth || {}), accounts: wAccounts().filter((x) => x.id !== a.id) } }); onClose()
  }
  return (
    <Sheet open title={a.id ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <div class="form">
        <label class="sel"><span>Nombre</span><input value={v.name} placeholder="Ej: Santander dólares, Balanz, Tarjeta Visa" onInput={(e) => setV({ ...v, name: e.currentTarget.value })} /></label>
        <Seg value={v.kind} onChange={(k) => setV({ ...v, kind: k })} options={[{ value: 'asset', label: 'Tengo' }, { value: 'debt', label: 'Debo' }]} />
        <Seg value={v.currency} onChange={(c) => setV({ ...v, currency: c })} options={[{ value: 'ARS', label: 'Pesos' }, { value: 'USD', label: 'Dólares' }]} />
        {v.kind === 'asset' && <label class="remember"><input type="checkbox" checked={!!v.liquid} onChange={(e) => setV({ ...v, liquid: e.currentTarget.checked })} /> Disponible (cuenta para el fondo de emergencia)</label>}
        {a.id && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Quitar</button>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}

export { inUsd }
