import { useState } from 'preact/hooks'
import { S, bulkPut, put, catById, accById, isPending } from './lib/store.js'
import { money, dayLabel, addDays, today } from './lib/format.js'
import { cleanBankDesc, merchantKey } from './lib/importer.js'
import { Icon, Seg, Sheet, Empty, toast } from './ui.jsx'

// Clave de comercio para recordar la categoría (solo extractos con descripción útil)
function keyOf(t) {
  if (!t.rawDesc || t.source === 'mercadopago' || t.source === 'manual' || t.source === 'gestor') return ''
  const k = merchantKey(cleanBankDesc(t.rawDesc))
  return k.length >= 3 ? k : ''
}
const titleOf = (t) => t.note || (t.rawDesc ? cleanBankDesc(t.rawDesc) : '') || 'Sin descripción'

// categorías más usadas en los últimos 4 meses, para los atajos
function topCats(kind, n = 4) {
  const since = addDays(today(), -120)
  const count = new Map()
  for (const t of S.txs) if (t.type === kind && t.categoryId && t.date >= since) count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => catById(id)).filter((c) => c && !c.archived).slice(0, n)
}

export function Pending({ onBack, onEdit }) {
  const all = S.txs.filter(isPending)
  const nExp = all.filter((t) => t.type === 'expense').length
  const [kind, setKind] = useState(nExp || !all.length ? 'expense' : 'income')
  const [sel, setSel] = useState(() => new Set())
  const [picker, setPicker] = useState(null) // ids[]
  const [remember, setRemember] = useState(true)
  const list = all.filter((t) => t.type === kind)
  const total = list.reduce((s, t) => s + t.amount, 0)
  const quick = topCats(kind, 3)

  async function assign(ids, categoryId) {
    const base = S.txs.filter((t) => ids.includes(t.id))
    let extra = []
    const keys = new Set(base.map(keyOf).filter(Boolean))
    if (remember && keys.size) {
      // también los otros pendientes del mismo comercio
      extra = S.txs.filter((t) => isPending(t) && t.type === kind && !ids.includes(t.id) && keys.has(keyOf(t)))
      for (const k of keys) {
        const existing = S.rules.find((r) => r.pattern === k)
        await put('rules', { ...(existing || {}), pattern: k, action: 'category', categoryId, updatedAt: Date.now() })
      }
    }
    const changed = [...base, ...extra]
    await bulkPut('txs', changed.map((t) => ({ ...t, categoryId, updatedAt: Date.now() })))
    setSel(new Set()); setPicker(null)
    const c = catById(categoryId)
    toast(`${changed.length === 1 ? '1 movimiento' : `${changed.length} movimientos`} a ${c?.name}${extra.length ? ` (${extra.length} del mismo comercio)` : ''}`,
      { label: 'Deshacer', fn: () => bulkPut('txs', changed) })
  }

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selAll = () => setSel(sel.size === list.length ? new Set() : new Set(list.map((t) => t.id)))

  return (
    <div class="overlay">
      <header class="top">
        <button class="icon-btn" onClick={onBack} aria-label="Volver"><Icon name="back" /></button>
        <h1>Sin categoría</h1>
      </header>
      <div class="pad-x">
        <Seg value={kind} onChange={(v) => { setKind(v); setSel(new Set()) }} options={[{ value: 'expense', label: `Gastos ${nExp}` }, { value: 'income', label: `Ingresos ${all.length - nExp}` }]} />
      </div>
      {list.length === 0 ? (
        <Empty title={all.length ? 'Nada pendiente acá.' : 'Todo categorizado.'}>
          <p class="fine">Cuando importes un extracto, lo que no se pueda categorizar solo va a aparecer en esta lista.</p>
        </Empty>
      ) : (
        <>
          <div class="pend-head">
            <span><b class="num">{money(total, { decimals: false })}</b> en {list.length} {list.length === 1 ? 'movimiento' : 'movimientos'}</span>
            <button class="link-btn" onClick={selAll}>{sel.size === list.length ? 'Quitar selección' : 'Seleccionar todos'}</button>
          </div>
          <ul class="pend-list">
            {list.map((t) => (
              <li class={`pend${sel.has(t.id) ? ' on' : ''}`}>
                <label class="imp-check"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label="Seleccionar" /></label>
                <div class="pend-main">
                  <button class="pend-top" onClick={() => onEdit(t)}>
                    <span class="pend-title">{titleOf(t)}</span>
                    <span class={`num pend-amt ${t.type === 'income' ? 'pos' : ''}`}>{money(t.amount, { sign: t.type === 'expense' ? '−' : '+' })}</span>
                    <span class="pend-meta">{dayLabel(t.date)}{S.accounts.length > 1 ? ` · ${accById(t.accountId)?.name || ''}` : ''}</span>
                  </button>
                  <div class="pend-chips">
                    {quick.map((c) => <button class="qchip" style={{ '--c': c.color }} onClick={() => assign([t.id], c.id)}><span aria-hidden="true">{c.emoji}</span>{c.name}</button>)}
                    <button class="qchip more" onClick={() => setPicker([t.id])}>Otra…</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {sel.size > 0 && (
            <footer class="sheet-foot sticky">
              <button class="btn primary" onClick={() => setPicker([...sel])}>Categorizar {sel.size} {sel.size === 1 ? 'seleccionado' : 'seleccionados'}</button>
            </footer>
          )}
        </>
      )}
      <Sheet open={!!picker} onClose={() => setPicker(null)} title={picker?.length > 1 ? `Categoría para ${picker.length} movimientos` : 'Elegí la categoría'}>
        <div class="tx-body">
          <label class="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} /> Recordar para este comercio en próximas importaciones</label>
          <div class="cat-grid">
            {S.categories.filter((c) => c.kind === kind && !c.archived).map((c) => (
              <button class="cat-btn" style={{ '--c': c.color }} onClick={() => assign(picker, c.id)}>
                <span class="cat-emoji" aria-hidden="true">{c.emoji}</span><span class="cat-name">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  )
}
