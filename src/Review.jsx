import { S, saveTx, remove, saveSettings } from './lib/store.js'
import { money as money0, uid } from './lib/format.js'
import { parseReview, findMatch, txFromItem, applySet, itemState, describeTx } from './lib/review.js'
import { toast, confirmDialog } from './ui.jsx'

const money = (c) => money0(c, { decimals: false })
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const ACTION = { add: 'Cargar', delete: 'Borrar', update: 'Aplicar', open: 'Abrir' }
const KIND = { add: 'Cargar', delete: 'Borrar', update: 'Corregir', open: 'Revisar' }

export const reviewProgress = () => {
  const r = S.settings.review
  if (!r) return null
  const st = r.items.map((it) => itemState(it, r.status || {}))
  const left = st.filter((s) => s === 'ready' || s === 'missing').length
  return { left, total: r.items.length }
}

const setStatus = (id, v) => { const r = S.settings.review; const status = { ...(r.status || {}) }; if (v) status[id] = v; else delete status[id]; return saveSettings({ review: { ...r, status } }) }

export function ReviewPage({ onEdit }) {
  const r = S.settings.review
  const load = async (file) => {
    try {
      const rv = parseReview(JSON.parse(await file.text()))
      if (r && !confirmDialog('Ya tenés una revisión cargada. ¿Reemplazarla por la nueva?')) return
      await saveSettings({ review: rv }); toast(`${rv.items.length} cambios para revisar`)
    } catch (e) { toast(e.message?.startsWith('No es') ? e.message : 'No pude leer el archivo') }
  }
  const picker = <label class="btn ghost file-btn">{r ? 'Cargar otra revisión' : 'Cargar archivo de revisión'}<input type="file" accept=".json,application/json" onChange={(e) => e.currentTarget.files[0] && load(e.currentTarget.files[0])} /></label>
  if (!r) return (
    <>
      <p class="fine pad-x">Cargá un archivo de revisión (.json) con cambios sugeridos para tus movimientos: cada uno lo aplicás con un toque, lo editás antes o lo descartás.</p>
      <div class="pad-x">{picker}</div>
    </>
  )

  const status = r.status || {}
  const rows = r.items.map((it) => ({ it, st: itemState(it, status) })).sort((a, b) => (a.it.date < b.it.date ? -1 : a.it.date > b.it.date ? 1 : 0))
  const open = rows.filter((x) => x.st === 'ready' || x.st === 'missing')
  const closed = rows.filter((x) => !(x.st === 'ready' || x.st === 'missing'))

  async function apply(it) {
    if (it.action === 'add') {
      const t = txFromItem(it)
      if (!t.categoryId) return onEdit(t) // falta elegir la categoría: se abre precargado
      const saved = await saveTx({ ...t, id: uid() })
      return toast(`Cargado: ${money(saved.amount)}`, { label: 'Deshacer', fn: () => remove('txs', saved.id) })
    }
    const m = findMatch(it.match)
    if (!m) return
    if (it.action === 'open') return onEdit(m)
    if (it.action === 'delete') {
      const copy = { ...m }
      await remove('txs', m.id); await setStatus(it.id, 'done')
      return toast('Borrado', { label: 'Deshacer', fn: async () => { await saveTx(copy); await setStatus(it.id, null) } })
    }
    const copy = { ...m }
    await saveTx(applySet(m, it.set || {})); await setStatus(it.id, 'done')
    toast('Cambio aplicado', { label: 'Deshacer', fn: async () => { await saveTx(copy); await setStatus(it.id, null) } })
  }
  const edit = (it) => (it.action === 'add' ? onEdit(txFromItem(it)) : onEdit(findMatch(it.match)))

  return (
    <>
      <div class="tiles fut-tiles">
        <div class="tile"><span class="tile-l">{r.name}</span><b class="tile-v num">{open.length ? `${open.length} pendientes` : 'Listo'}</b><span class="tile-s">{closed.length} de {rows.length} resueltos</span></div>
      </div>
      <p class="fine pad-x">Tocá el botón para aplicar cada cambio, "Editar" para abrirlo antes de guardar, o "No va" si no corresponde. Todo se puede deshacer.</p>
      {open.length > 0 && (
        <ul class="rv-list">
          {open.map(({ it, st }) => {
            const m = it.action !== 'add' && findMatch(it.match)
            return (
              <li class={`rv-item rv-${it.action}`}>
                <div class="rv-top"><span class="rv-date">{ddmm(it.date)}</span><span class={`rv-kind k-${it.action}`}>{KIND[it.action]}</span></div>
                <b class="rv-title">{it.title}</b>
                {it.detail && <span class="rv-detail">{it.detail}</span>}
                {it.action === 'add' && (() => { const t = txFromItem(it); return <span class="rv-now">Se carga: {t.type === 'income' ? 'ingreso · ' : ''}{describeTx(t).replace('Sin categoría', 'elegís la categoría')} · <span class="num">{money(t.amount)}</span></span> })()}
                {m ? <span class="rv-now">Hoy: {describeTx(m)} · <span class="num">{money(m.amount)}</span></span>
                  : st === 'missing' ? <span class="rv-now warn">No encuentro este movimiento ({money(Math.round(it.match.amount * 100))} el {ddmm(it.match.date)}). Quizás ya lo cambiaste.</span> : null}
                <div class="rv-btns">
                  {st === 'ready' && <button class={`btn sm ${it.action === 'delete' ? 'danger-fill' : 'primary'}`} onClick={() => apply(it)}>{it.action === 'add' && !txFromItem(it).categoryId ? 'Cargar…' : ACTION[it.action]}</button>}
                  {st === 'ready' && it.action !== 'open' && it.action !== 'delete' && <button class="btn sm ghost" onClick={() => edit(it)}>Editar</button>}
                  {it.action === 'open' && st === 'ready' && <button class="btn sm ghost" onClick={() => setStatus(it.id, 'done')}>Listo</button>}
                  <button class="btn sm ghost" onClick={() => setStatus(it.id, 'skipped')}>No va</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {closed.length > 0 && (
        <details class="proj-table pad-x rv-closed">
          <summary>Resueltos ({closed.length})</summary>
          <ul class="rv-done">
            {closed.map(({ it, st }) => (
              <li><span>{ddmm(it.date)} · {it.title}</span><small>{st === 'skipped' ? 'No va' : st === 'already' ? 'Ya estaba' : 'Hecho'}</small>
                {(status[it.id]) && <button class="link-btn inline" onClick={() => setStatus(it.id, null)}>Reabrir</button>}</li>
            ))}
          </ul>
        </details>
      )}
      <div class="pad-x rv-foot">
        {picker}
        {!open.length && <button class="btn ghost" onClick={() => saveSettings({ review: null })}>Cerrar revisión</button>}
      </div>
    </>
  )
}
