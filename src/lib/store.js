import Dexie from 'dexie'
import { useEffect, useState } from 'preact/hooks'
import { uid, today } from './format.js'
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, DEFAULT_TAGS, colorFor } from './defaults.js'

export const db = new Dexie('gastos')
db.version(1).stores({
  accounts: 'id',
  categories: 'id, kind',
  tags: 'id',
  txs: 'id, date, type, accountId, categoryId, externalId, batchId',
  rules: 'id, pattern',
  batches: 'id',
  meta: 'key',
})
db.version(2).stores({ budgets: 'id, categoryId' })

const TABLES = ['accounts', 'categories', 'tags', 'txs', 'rules', 'batches', 'budgets']

// Todo el estado vive en memoria (son pocos miles de filas); IndexedDB es la persistencia.
export const S = { ready: false, accounts: [], categories: [], tags: [], txs: [], rules: [], batches: [], budgets: [], settings: {}, v: 0 }
const listeners = new Set()
function emit() { S.v++; listeners.forEach((f) => f()) }

// Promedio mensual del dólar elegido ({ 'YYYY-MM': cotización }), para presupuestos en USD
export function setFx(map) { S.fx = map; emit() }

export function useStore() {
  const [, set] = useState(0)
  useEffect(() => { const f = () => set((x) => x + 1); listeners.add(f); return () => listeners.delete(f) }, [])
  return S
}

function sortAll() {
  S.txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)))
  S.categories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  S.accounts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  S.tags.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function load() {
  for (const t of TABLES) S[t] = await db[t].toArray()
  const meta = await db.meta.get('settings')
  S.settings = meta?.value || {}
  if (!S.accounts.length && !S.txs.length) await seed()
  sortAll()
  S.ready = true
  emit()
  requestPersist()
}

async function seed() {
  const accounts = [{ id: uid(), name: 'Principal', initial: 0, order: 0 }]
  const categories = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({ id: uid(), kind: 'expense', order: i, color: colorFor(i), ...c })),
    ...DEFAULT_INCOME_CATEGORIES.map((c, i) => ({ id: uid(), kind: 'income', order: i, color: colorFor(i), ...c })),
  ]
  const tags = DEFAULT_TAGS.map((name) => ({ id: uid(), name }))
  await db.transaction('rw', db.accounts, db.categories, db.tags, async () => {
    await db.accounts.bulkAdd(accounts); await db.categories.bulkAdd(categories); await db.tags.bulkAdd(tags)
  })
  Object.assign(S, { accounts, categories, tags })
  await saveSettings({ defaultAccountId: accounts[0].id })
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted()
      S.persisted = already || (await navigator.storage.persist())
      emit()
    }
  } catch { /* sin soporte */ }
}

export async function saveSettings(patch) {
  S.settings = { ...S.settings, ...patch }
  await db.meta.put({ key: 'settings', value: S.settings })
  emit()
}

// ---------- CRUD genérico ----------
export async function put(table, obj) {
  const o = { ...obj, id: obj.id || uid() }
  await db[table].put(o)
  const i = S[table].findIndex((x) => x.id === o.id)
  if (i >= 0) S[table][i] = o; else S[table].push(o)
  sortAll(); emit()
  return o
}
export async function bulkPut(table, objs) {
  if (!objs.length) return
  await db[table].bulkPut(objs)
  const byId = new Map(objs.map((o) => [o.id, o]))
  S[table] = S[table].map((x) => byId.get(x.id) || x)
  sortAll(); emit()
}
export const isPending = (t) => (t.type === 'expense' || t.type === 'income') && !t.categoryId
export async function remove(table, id) {
  await db[table].delete(id)
  S[table] = S[table].filter((x) => x.id !== id)
  emit()
}

export async function saveTx(tx) {
  return put('txs', { createdAt: Date.now(), ...tx, updatedAt: Date.now() })
}

export async function bulkAddTxs(txs, batch) {
  await db.transaction('rw', db.txs, db.batches, async () => {
    await db.txs.bulkAdd(txs)
    if (batch) await db.batches.add(batch)
  })
  S.txs.push(...txs)
  if (batch) S.batches.push(batch)
  sortAll(); emit()
}

export async function undoBatch(batchId) {
  const ids = S.txs.filter((t) => t.batchId === batchId).map((t) => t.id)
  await db.transaction('rw', db.txs, db.batches, async () => {
    await db.txs.bulkDelete(ids); await db.batches.delete(batchId)
  })
  S.txs = S.txs.filter((t) => t.batchId !== batchId)
  S.batches = S.batches.filter((b) => b.id !== batchId)
  emit()
  return ids.length
}

// ---------- Backup ----------
export function exportData() {
  const out = { app: 'gastos', version: 1, exportedAt: new Date().toISOString() }
  for (const t of TABLES) out[t] = S[t]
  out.settings = S.settings
  return out
}

export async function importData(data) {
  if (!data || data.app !== 'gastos' || !Array.isArray(data.txs)) throw new Error('El archivo no es un backup de esta app.')
  await db.transaction('rw', [...TABLES.map((t) => db[t]), db.meta], async () => {
    for (const t of TABLES) { await db[t].clear(); if (data[t]?.length) await db[t].bulkAdd(data[t]) }
    await db.meta.put({ key: 'settings', value: { ...(data.settings || {}), lastBackupAt: S.settings.lastBackupAt } })
  })
  await load()
}

export async function wipeAll() {
  await db.delete(); await db.open()
  for (const t of TABLES) S[t] = []
  S.settings = {}
  await load()
}

// ---------- Derivados ----------
export const catById = (id) => S.categories.find((c) => c.id === id)
export const accById = (id) => S.accounts.find((a) => a.id === id)
export const tagById = (id) => S.tags.find((t) => t.id === id)

export function balances() {
  const b = Object.fromEntries(S.accounts.map((a) => [a.id, a.initial || 0]))
  for (const t of S.txs) {
    if (t.type === 'expense') b[t.accountId] = (b[t.accountId] || 0) - t.amount
    else if (t.type === 'income') b[t.accountId] = (b[t.accountId] || 0) + t.amount
    else if (t.type === 'transfer') {
      b[t.accountId] = (b[t.accountId] || 0) - t.amount
      b[t.toAccountId] = (b[t.toAccountId] || 0) + t.amount
    }
  }
  return b
}

export function defaultAccountId() {
  return S.accounts.find((a) => a.id === S.settings.defaultAccountId && !a.archived)?.id || S.accounts.find((a) => !a.archived)?.id
}

export { today }
