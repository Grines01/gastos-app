// Recordatorios: tarjetas (2 días antes y el mismo día del cierre y del vencimiento)
// y gastos compartidos (a los 2 y a los 7 días, si alguien todavía no te pagó).
// Corre dentro del service worker: Android lo despierta con "periodicsync" aunque la app esté cerrada,
// y la app también lo pide cada vez que se abre. Cada aviso se manda una sola vez.
/* global self, clients, indexedDB */
const DAYS = 2
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate()
const parts = (s) => { const [y, m, d] = s.split('-').map(Number); return [y, m - 1, d] }
const dayIn = (y, m, day) => { const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; return iso(yy, mm, Math.min(day, lastDay(yy, mm))) }
const onOrAfter = (date, day) => { const [y, m] = parts(date); const c = dayIn(y, m, day); return c >= date ? c : dayIn(y, m + 1, day) }
const between = (a, b) => Math.round((Date.UTC(...parts(b)) - Date.UTC(...parts(a))) / 86400000)
const todayIso = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()) }
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const when = (n) => (n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`)
const money = (c) => `$ ${Math.round(c / 100).toLocaleString('es-AR')}`

function openDb() {
  return new Promise((res, rej) => { const r = indexedDB.open('gastos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}
function req(store, mode, fn) {
  return new Promise((res, rej) => { const q = fn(store); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
}

const addDays = (s, n) => { const [y, m, d] = parts(s); const x = new Date(Date.UTC(y, m, d + n)); return x.toISOString().slice(0, 10) }
const namesText = (ns) => (ns.length <= 1 ? ns.join('') : `${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}`)

async function checkReminders() {
  const db = await openDb()
  try {
    const stores = ['meta', 'txs', ...(db.objectStoreNames.contains('cards') ? ['cards'] : [])]
    const tx = db.transaction(stores, 'readonly')
    const settings = (await req(tx.objectStore('meta'), 'r', (s) => s.get('settings')))?.value || {}
    const sent = (await req(tx.objectStore('meta'), 'r', (s) => s.get('notified')))?.value || {}
    if (!settings.notify) return
    const cards = stores.includes('cards') ? await req(tx.objectStore('cards'), 'r', (s) => s.getAll()) : []
    const today = todayIso()
    const txs = await req(tx.objectStore('txs'), 'r', (s) => s.index('date').getAll(IDBKeyRange.lowerBound(addDays(today, -60)))).catch(() => [])
    const out = []
    // tarjetas
    for (const c of cards) {
      for (const [kind, date] of [['cierra', onOrAfter(today, c.closeDay)], ['vence', onOrAfter(today, c.dueDay)]]) {
        const n = between(today, date), key = `${c.id}|${kind}|${date}`
        if (n < 0 || n > DAYS || sent[key]) continue
        const cuotas = kind === 'vence' ? txs.filter((t) => t.installment?.cardId === c.id && t.date === date).reduce((s, t) => s + t.amount, 0) : 0
        out.push({ keys: [key], title: c.name, body: kind === 'cierra'
          ? `Cierra ${when(n)} (${ddmm(date)}). Lo que compres después entra en el próximo resumen.`
          : `Vence ${when(n)} (${ddmm(date)}).${cuotas ? ` Cuotas programadas: ${money(cuotas)}.` : ''}` })
      }
    }
    // gastos compartidos: ¿te pagaron?
    for (const t of txs) {
      const open = (t.type === 'expense' && t.split?.people || []).filter((p) => !p.paidId && !p.waived)
      if (!open.length || t.date > today) continue
      const age = between(t.date, today)
      const due = [2, 7].filter((d) => age >= d)
      if (!due.length || sent[`split|${t.id}|${due.at(-1)}`]) continue
      const names = open.map((p) => p.name), owed = open.reduce((s, p) => s + p.amount, 0)
      out.push({ keys: due.map((d) => `split|${t.id}|${d}`), title: '¿Te pagaron?', page: 'debts',
        body: `${namesText(names)} te ${names.length > 1 ? 'deben' : 'debe'} ${money(owed)} de ${t.note ? `"${t.note}"` : 'un gasto compartido'} (${ddmm(t.date)}).` })
    }
    if (!out.length) return
    for (const e of out) {
      await self.registration.showNotification(e.title, { body: e.body, tag: e.keys.at(-1), icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './', page: e.page || null } })
      for (const k of e.keys) sent[k] = Date.now()
    }
    // se guardan los avisos mandados (los de más de 60 días se olvidan)
    for (const k of Object.keys(sent)) if (Date.now() - sent[k] > 60 * 86400000) delete sent[k]
    await req(db.transaction('meta', 'readwrite').objectStore('meta'), 'w', (s) => s.put({ key: 'notified', value: sent }))
  } finally { db.close() }
}

self.addEventListener('periodicsync', (e) => { if (e.tag === 'card-reminders') e.waitUntil(checkReminders()) })
self.addEventListener('message', (e) => { if (e.data?.type === 'check-reminders') e.waitUntil(checkReminders().catch(() => {})) })
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const page = e.notification.data?.page
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    if (ws[0]) { if (page) ws[0].postMessage({ type: 'open', page }); return ws[0].focus() }
    return clients.openWindow(page === 'debts' ? './#te-deben' : './')
  }))
})
