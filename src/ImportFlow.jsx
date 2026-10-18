import { useState } from 'preact/hooks'
import { S, defaultAccountId, catById } from './lib/store.js'
import { readRows, detect, toItems, propose, commit } from './lib/importer.js'
import { money, ddmm } from './lib/format.js'
import { Icon, toast, download } from './ui.jsx'

const FORMAT_NAME = { santander: 'Extracto de Santander', gestor: 'Export de Gestor de gastos', simple: 'CSV simple' }
const STATUS = {
  new: null,
  dup: 'Parece ya cargado',
  hist: 'Categoría según tus cargas anteriores',
  imported: 'Ya importado antes',
  skip: 'Ignorado por regla',
}
const TEMPLATE = 'fecha;tipo;monto;moneda;cotizacion;cuenta;categoria;etiquetas;descripcion\n18/10/2026;gasto;12575;ARS;;Principal;Supermercado;;3M supermercados\n15/10/2026;ingreso;1000;USD;1540;Principal;Sueldo;;Sueldo octubre\n'

export function ImportFlow({ onClose }) {
  const [step, setStep] = useState('pick')
  const [accountId, setAccountId] = useState(defaultAccountId())
  const [file, setFile] = useState(null)
  const [det, setDet] = useState(null)
  const [rows, setRows] = useState([])
  const [view, setView] = useState('all')
  const [limit, setLimit] = useState(120)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function onFile(f) {
    setError(''); setFile(f); setBusy(true)
    try {
      const raw = await readRows(f)
      const d = detect(raw)
      const items = toItems(raw, d)
      if (!items.length) throw new Error('El archivo no tiene movimientos con fecha y monto.')
      setDet(d)
      setRows(propose(items, { format: d.format, accountId }))
      setView('all'); setLimit(120); setStep('review')
    } catch (e) { setError(e.message || 'No pude leer el archivo.') }
    setBusy(false)
  }

  const update = (i, patch) => setRows((rs) => {
    const next = rs.map((r) => (r.i === i ? { ...r, ...patch, touched: true } : r))
    // lo que elegís para un comercio se aplica a los otros del mismo comercio que no tocaste
    const src = next.find((r) => r.i === i)
    if (('categoryId' in patch || 'type' in patch) && src.key) {
      return next.map((r) => (r.i !== i && !r.touched && r.key === src.key && r.status === 'new' && !r.categoryId
        ? { ...r, type: src.type, categoryId: src.categoryId, toAccountId: src.toAccountId, include: src.type !== 'skip' } : r))
    }
    return next
  })

  async function confirm() {
    setBusy(true)
    try {
      const res = await commit(rows, { fileName: file?.name, format: det.format })
      setResult(res); setStep('done')
    } catch (e) { toast('No se pudo importar: ' + e.message) }
    setBusy(false)
  }

  const counts = {
    all: rows.length,
    include: rows.filter((r) => r.include && r.type !== 'skip').length,
    dup: rows.filter((r) => r.status === 'dup' || r.status === 'imported').length,
    uncat: rows.filter((r) => r.include && (r.type === 'expense' || r.type === 'income') && !r.categoryId && !r.newCategory).length,
    skip: rows.filter((r) => r.type === 'skip').length,
    badTransfer: rows.filter((r) => r.include && r.type === 'transfer' && !r.toAccountId).length,
  }
  const shown = rows.filter((r) => view === 'all' ? true
    : view === 'include' ? r.include && r.type !== 'skip'
    : view === 'dup' ? r.status === 'dup' || r.status === 'imported'
    : view === 'uncat' ? r.include && (r.type === 'expense' || r.type === 'income') && !r.categoryId && !r.newCategory
    : r.type === 'skip')

  return (
    <div class="overlay">
      <header class="top">
        <button class="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="back" /></button>
        <h1>{step === 'review' ? FORMAT_NAME[det.format] : 'Importar movimientos'}</h1>
      </header>

      {step === 'pick' && (
        <div class="screen pad">
          <p class="lead">Subí un extracto y revisás los movimientos antes de guardarlos. Lo que ya cargaste a mano se detecta y no se duplica.</p>
          <label class="sel"><span>Cuenta donde se cargan</span>
            <select value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>{S.accounts.filter((a) => !a.archived).map((a) => <option value={a.id}>{a.name}</option>)}</select>
          </label>
          <label class={`drop${busy ? ' busy' : ''}`}>
            <Icon name="upload" size={28} />
            <span>{busy ? 'Leyendo archivo…' : 'Elegir archivo .xlsx o .csv'}</span>
            <input type="file" accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.currentTarget.files[0] && onFile(e.currentTarget.files[0])} />
          </label>
          {error && <p class="error" role="alert">{error}</p>}
          <h3 class="sub-h">Formatos que entiende</h3>
          <ul class="plain">
            <li><b>Santander:</b> el Excel de "Últimos movimientos" del home banking, tal cual se descarga.</li>
            <li><b>Gestor de gastos:</b> el export de gastos o de ingresos, para migrar tu historial.</li>
            <li><b>CSV simple:</b> columnas fecha, monto y descripcion. Opcionales: tipo, moneda, cotizacion, cuenta, categoria, etiquetas. Un monto negativo es un gasto.</li>
          </ul>
          <button class="btn ghost" onClick={() => download('plantilla-importacion.csv', TEMPLATE, 'text/csv')}><Icon name="download" size={18} /> Descargar plantilla CSV</button>
        </div>
      )}

      {step === 'review' && (
        <>
          <div class="chips scroll import-tabs">
            {[['all', 'Todos'], ['include', 'A importar'], ['uncat', 'Sin categoría'], ['dup', 'Ya cargados'], ['skip', 'Ignorados']].map(([k, l]) => (
              <button class={`chip${view === k ? ' on' : ''}`} onClick={() => { setView(k); setLimit(120) }}>{l} <span class="count">{counts[k]}</span></button>
            ))}
          </div>
          <div class="screen import-list">
            {shown.slice(0, limit).map((r) => <ImportRow r={r} update={update} />)}
            {shown.length > limit && <button class="btn ghost wide" onClick={() => setLimit(limit + 200)}>Ver más ({shown.length - limit})</button>}
            {shown.length === 0 && <p class="fine center">Nada en esta lista.</p>}
          </div>
          <footer class="sheet-foot sticky">
            <p class="fine">{counts.badTransfer > 0 ? `Elegí la otra cuenta en ${counts.badTransfer} ${counts.badTransfer === 1 ? 'transferencia' : 'transferencias'}.` : counts.uncat > 0 ? `${counts.uncat} van sin categoría: los podés categorizar después.` : 'Lo que corrijas a mano se recuerda para la próxima.'}</p>
            <button class="btn primary" disabled={busy || counts.include === 0 || counts.badTransfer > 0} onClick={confirm}>
              {busy ? 'Importando…' : `Importar ${counts.include} ${counts.include === 1 ? 'movimiento' : 'movimientos'}`}
            </button>
          </footer>
        </>
      )}

      {step === 'done' && (
        <div class="screen pad done">
          <p class="done-big num">{result.imported}</p>
          <p class="lead">{result.imported === 1 ? 'movimiento importado' : 'movimientos importados'}{result.learned ? `. Aprendí ${result.learned} ${result.learned === 1 ? 'regla nueva' : 'reglas nuevas'} para la próxima importación.` : '.'}</p>
          <p class="fine">Si algo salió mal, podés deshacer esta importación desde Más → Importaciones.</p>
          <button class="btn primary" onClick={onClose}>Listo</button>
        </div>
      )}
    </div>
  )
}

function ImportRow({ r, update }) {
  const kind = r.it.amount < 0 ? 'expense' : 'income'
  const cats = S.categories.filter((c) => c.kind === r.type && !c.archived)
  const st = STATUS[r.status] || (r.fromHistory && !r.touched ? STATUS.hist : null)
  return (
    <div class={`imp-row${r.include && r.type !== 'skip' ? '' : ' off'}`}>
      <label class="imp-check">
        <input type="checkbox" checked={r.include && r.type !== 'skip'} onChange={(e) => update(r.i, { include: e.currentTarget.checked, type: r.type === 'skip' && e.currentTarget.checked ? kind : r.type })} aria-label="Incluir" />
      </label>
      <div class="imp-main">
        <div class="imp-top">
          <span class="imp-date num">{ddmm(r.it.date)}</span>
          <span class="imp-desc">{r.it.desc || '(sin descripción)'}</span>
          <span class={`imp-amt num ${kind === 'income' ? 'pos' : ''}`}>{money(r.amount, { sign: kind === 'expense' ? '−' : '+' })}</span>
        </div>
        {r.it.currency === 'USD' && <p class="imp-note">US$ {(r.it.origAmount / 100).toLocaleString('es-AR')} a {r.it.rate.toLocaleString('es-AR')}</p>}
        {st && (
          <p class={`imp-status s-${r.status}`}>
            {st}{r.match ? `: ${ddmm(r.match.date)} · ${catById(r.match.categoryId)?.name || 'sin categoría'}${r.match.note ? ` · ${r.match.note}` : ''} · ${money(r.match.amount)}` : ''}
          </p>
        )}
        <div class="imp-ctrls">
          <select value={r.type} onChange={(e) => { const v = e.currentTarget.value; update(r.i, { type: v, include: v !== 'skip', categoryId: v === r.type ? r.categoryId : null }) }} aria-label="Tipo">
            <option value="expense">Gasto</option><option value="income">Ingreso</option><option value="transfer">Transferencia</option><option value="skip">Ignorar</option>
          </select>
          {(r.type === 'expense' || r.type === 'income') && (
            <select class={!r.categoryId && !r.newCategory ? 'need' : ''} value={r.categoryId || (r.newCategory ? 'new' : '')} onChange={(e) => update(r.i, { categoryId: e.currentTarget.value || null, newCategory: null, include: true })} aria-label="Categoría">
              <option value="">? Sin categoría</option>
              {r.newCategory && <option value="new">{r.newCategory} (nueva)</option>}
              {cats.map((c) => <option value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          )}
          {r.type === 'transfer' && (
            <select class={!r.toAccountId ? 'need' : ''} value={r.toAccountId || ''} onChange={(e) => update(r.i, { toAccountId: e.currentTarget.value || null })} aria-label="Cuenta destino">
              <option value="">{kind === 'income' ? '¿Desde qué cuenta?' : '¿Hacia qué cuenta?'}</option>
              {S.accounts.filter((a) => a.id !== r.accountId).map((a) => <option value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
      </div>
    </div>
  )
}
