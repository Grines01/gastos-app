// Revisión de datos: una lista de cambios sugeridos (un archivo JSON) que se aplican uno por uno.
// El archivo NO forma parte de la app: se carga desde el teléfono y queda guardado en los ajustes.
//
// { app: 'gastos-revision', version: 1, name, items: [ item ] }
// item: { id, date, title, detail?, action, match?, tx?, set? }
//   action 'add'    → tx: { type, date, amount (pesos), category?, tags?, note }   (sin category: se abre para elegirla)
//   action 'delete' → match
//   action 'update' → match + set: { category?, addTags?, removeTags?, amount? (pesos), note?, rate? }
//   action 'open'   → match (para revisar a mano)
//   match: { date, type, amount (pesos), note? } — se busca por fecha, tipo y monto (± $1)
import { S, catById, tagById } from './store.js'
import { uid } from './format.js'

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const cents = (p) => Math.round(Number(p) * 100)
export const catByName = (name, kind) => name && S.categories.find((c) => norm(c.name) === norm(name) && (!kind || c.kind === kind))
export const tagByName = (name) => name && S.tags.find((t) => norm(t.name) === norm(name))

export function parseReview(data) {
  if (data?.app !== 'gastos-revision' || !Array.isArray(data.items)) throw new Error('No es un archivo de revisión')
  return { name: data.name || 'Revisión', loadedAt: Date.now(), items: data.items.map((it, i) => ({ id: it.id || `r${i}`, ...it })), status: {} }
}

export function findMatch(m) {
  if (!m) return null
  const a = cents(m.amount)
  const cands = S.txs.filter((t) => t.date === m.date && (!m.type || t.type === m.type) && Math.abs(t.amount - a) <= 100)
  if (cands.length <= 1 || !m.note) return cands[0] || null
  return cands.find((t) => norm(t.note).includes(norm(m.note))) || cands[0]
}

// Movimiento nuevo a partir de un ítem 'add' (sin guardar)
export function txFromItem(it) {
  const t = it.tx
  const type = t.type || 'expense'
  const cat = catByName(t.category, type)
  return {
    type, date: t.date, amount: cents(t.amount), categoryId: cat?.id || null, accountId: S.accounts.find((a) => !a.archived)?.id,
    tagIds: (t.tags || []).map(tagByName).filter(Boolean).map((x) => x.id), note: t.note || '', currency: 'ARS', origAmount: null, rate: null,
    source: 'manual', reviewId: it.id,
  }
}

// Movimiento actualizado a partir de un ítem 'update' (sin guardar)
export function applySet(t, set) {
  const o = { ...t }
  if (set.category) { const c = catByName(set.category, t.type); if (c) o.categoryId = c.id }
  if (set.addTags) for (const n of set.addTags) { const g = tagByName(n); if (g && !(o.tagIds || []).includes(g.id)) o.tagIds = [...(o.tagIds || []), g.id] }
  if (set.removeTags) o.tagIds = (o.tagIds || []).filter((id) => !set.removeTags.some((n) => norm(tagById(id)?.name) === norm(n)))
  if (set.note != null) o.note = set.note
  if (set.rate && o.currency === 'USD' && o.origAmount) { o.rate = set.rate; o.amount = Math.round(o.origAmount * set.rate) }
  if (set.amount != null) o.amount = cents(set.amount)
  return o
}

// Estado de un ítem: 'done' | 'skipped' | 'ready' | 'missing' (no encuentro el movimiento) | 'already' (ya está así)
export function itemState(it, status) {
  if (status[it.id]) return status[it.id]
  if (it.action === 'add') return S.txs.some((t) => t.reviewId === it.id) ? 'done' : 'ready'
  const m = findMatch(it.match)
  if (!m) return it.action === 'delete' ? 'already' : 'missing'
  if (it.action === 'update') {
    const n = applySet(m, it.set || {})
    const same = n.categoryId === m.categoryId && n.amount === m.amount && n.note === m.note && (n.tagIds || []).join() === (m.tagIds || []).join()
    if (same) return 'already'
  }
  return 'ready'
}

export const describeTx = (t) => `${catById(t.categoryId)?.name || 'Sin categoría'}${t.note ? ` · ${t.note}` : ''}`
export { uid }
