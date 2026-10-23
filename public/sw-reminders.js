// Recordatorios de tarjetas: avisa 2 días antes (y el mismo día) del cierre y del vencimiento.
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

async function checkReminders() {
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains('cards')) return
    const tx = db.transaction(['cards', 'meta', 'txs'], 'readonly')
    const cards = await req(tx.objectStore('cards'), 'r', (s) => s.getAll())
    const settings = (await req(tx.objectStore('meta'), 'r', (s) => s.get('settings')))?.value || {}
    const sent = (await req(tx.objectStore('meta'), 'r', (s) => s.get('notified')))?.value || {}
    if (!settings.notify || !cards.length) return
    const today = todayIso()
    const events = []
    for (const c of cards) {
      for (const [kind, date] of [['cierra', onOrAfter(today, c.closeDay)], ['vence', onOrAfter(today, c.dueDay)]]) {
        const n = between(today, date)
        if (n >= 0 && n <= DAYS && !sent[`${c.id}|${kind}|${date}`]) events.push({ c, kind, date, n })
      }
    }
    if (!events.length) return
    const txs = await new Promise((res) => { const q = db.transaction('txs').objectStore('txs').index('date').getAll(IDBKeyRange.lowerBound(today)); q.onsuccess = () => res(q.result); q.onerror = () => res([]) })
    for (const e of events) {
      const cuotas = e.kind === 'vence' ? txs.filter((t) => t.installment?.cardId === e.c.id && t.date === e.date).reduce((s, t) => s + t.amount, 0) : 0
      const body = e.kind === 'cierra'
        ? `Cierra ${when(e.n)} (${ddmm(e.date)}). Lo que compres después entra en el próximo resumen.`
        : `Vence ${when(e.n)} (${ddmm(e.date)}).${cuotas ? ` Cuotas programadas: ${money(cuotas)}.` : ''}`
      await self.registration.showNotification(e.c.name, { body, tag: `${e.c.id}|${e.kind}|${e.date}`, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './' } })
      sent[`${e.c.id}|${e.kind}|${e.date}`] = Date.now()
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
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => (ws[0] ? ws[0].focus() : clients.openWindow('./'))))
})
