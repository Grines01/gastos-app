import { useEffect, useState } from 'preact/hooks'
import { S, put, remove, saveSettings, today } from './lib/store.js'
import { money } from './lib/format.js'
import { nextDates, dayIn, reminders, whenText } from './lib/cards.js'
import { Icon, Sheet, toast, confirmDialog } from './ui.jsx'

const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const scheduledFor = (cardId, date) => S.txs.filter((t) => t.installment?.cardId === cardId && t.date === date).reduce((s, t) => s + t.amount, 0)

// ---------- avisos en el teléfono ----------
export const notifySupported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator
export async function askReminderCheck() {
  try {
    if (!S.settings.notify || !notifySupported() || Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    reg.active?.postMessage({ type: 'check-reminders' })
  } catch { /* sin service worker */ }
}
async function enableNotify() {
  if (!notifySupported()) return toast('Este navegador no permite notificaciones')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return toast('Sin permiso no puedo avisarte. Lo podés habilitar en los ajustes del teléfono.')
  await saveSettings({ notify: true })
  try {
    const reg = await navigator.serviceWorker.ready
    if (reg.periodicSync) await reg.periodicSync.register('card-reminders', { minInterval: 12 * 3600 * 1000 })
  } catch { /* el sistema decide; igual avisa al abrir la app */ }
  toast('Avisos activados')
  askReminderCheck()
}
async function disableNotify() {
  await saveSettings({ notify: false })
  try { const reg = await navigator.serviceWorker.ready; await reg.periodicSync?.unregister('card-reminders') } catch { /* nada */ }
  toast('Avisos desactivados')
}

// Avisos de los próximos 2 días (para Inicio)
export function cardAlerts() {
  return reminders(S.cards, today(), 2).map((r) => {
    const cuotas = r.kind === 'vencimiento' ? scheduledFor(r.card.id, r.date) : 0
    return { ...r, text: `${r.card.name} ${r.kind === 'cierre' ? 'cierra' : 'vence'} ${whenText(r.inDays)} (${ddmm(r.date)})${cuotas ? ` · cuotas ${money(cuotas, { decimals: false })}` : ''}` }
  })
}

// ---------- Más → Tarjetas ----------
export function CardsPage() {
  const [edit, setEdit] = useState(null)
  const t0 = today()
  const perm = notifySupported() ? Notification.permission : 'unsupported'
  const on = S.settings.notify && perm === 'granted'
  return (
    <>
      <p class="fine pad-x">Con el día de cierre y de vencimiento, las compras en cuotas se cargan solas en cada vencimiento y te aviso 2 días antes.</p>
      {S.cards.length > 0 && (
        <ul class="card-list pad-x">
          {S.cards.map((c) => {
            const nd = nextDates(c, t0)
            const [y, m] = nd.due.split('-').map(Number)
            const dues = [0, 1, 2].map((k) => dayIn(y, m - 1 + k, c.dueDay)) // los próximos 3 vencimientos
            return (
              <li>
                <button class="cc-row" onClick={() => setEdit(c)}>
                  <span class="cc-top"><b>{c.name}</b><small>Cierra el {c.closeDay} · vence el {c.dueDay}</small></span>
                  <span class="cc-next">Próximo cierre <b>{ddmm(nd.close)}</b> · próximo vencimiento <b>{ddmm(nd.due)}</b></span>
                  <span class="cc-sched">{dues.map((d) => { const v = scheduledFor(c.id, d); return <span>{ddmm(d)}: <b class="num">{v ? money(v, { decimals: false }) : '—'}</b></span> })}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {S.cards.length > 0 && <p class="fine pad-x">Montos por vencimiento: las cuotas programadas en esa tarjeta (no incluye lo que todavía no cargaste).</p>}
      <button class="btn ghost wide" onClick={() => setEdit({ name: '', closeDay: 26, dueDay: 7 })}><Icon name="plus" size={18} /> Nueva tarjeta</button>

      <section class="card">
        <h2>Avisos en el teléfono</h2>
        {perm === 'unsupported' ? <p class="fine">Este navegador no permite notificaciones. Igual vas a ver el aviso en Inicio.</p> : (
          <>
            <p class="fine">{on
              ? 'Activados. Te aviso 2 días antes y el mismo día de cada cierre y vencimiento. Android revisa en segundo plano cuando él decide (en general una vez por día) y además cada vez que abrís la app. El aviso también aparece en Inicio.'
              : perm === 'denied' ? 'Las notificaciones están bloqueadas para esta app. Habilitalas en Ajustes del teléfono → Apps → Mis gastos → Notificaciones.'
              : 'Activalos para recibir una notificación 2 días antes de cada cierre y vencimiento. El aviso en Inicio aparece siempre.'}</p>
            {on ? <button class="btn ghost" onClick={disableNotify}>Desactivar avisos</button>
              : perm !== 'denied' && <button class="btn primary" onClick={enableNotify} disabled={!S.cards.length}>Activar avisos</button>}
            {!S.cards.length && !on && <p class="fine">Primero cargá una tarjeta.</p>}
          </>
        )}
      </section>
      <CardSheet c={edit} onClose={() => setEdit(null)} />
    </>
  )
}

function CardSheet({ c, onClose }) {
  const [v, setV] = useState(null)
  useEffect(() => { setV(c ? { ...c, closeDay: String(c.closeDay), dueDay: String(c.dueDay) } : null) }, [c])
  if (!c || !v) return null
  const n = S.txs.filter((t) => t.installment?.cardId === c.id && t.date >= today()).length
  const save = async () => {
    const closeDay = Number(v.closeDay), dueDay = Number(v.dueDay)
    if (!v.name.trim()) return toast('Poné un nombre')
    if (!(closeDay >= 1 && closeDay <= 31) || !(dueDay >= 1 && dueDay <= 31)) return toast('Los días van del 1 al 31')
    await put('cards', { ...v, name: v.name.trim(), closeDay, dueDay })
    onClose(); toast(c.id ? 'Tarjeta actualizada' : 'Tarjeta creada')
  }
  const del = async () => {
    if (!confirmDialog(n ? `Tiene ${n} cuotas por venir: quedan cargadas, pero sin avisos. ¿Eliminar la tarjeta?` : '¿Eliminar la tarjeta?')) return
    await remove('cards', c.id); onClose(); toast('Tarjeta eliminada')
  }
  return (
    <Sheet open title={c.id ? 'Editar tarjeta' : 'Nueva tarjeta'} onClose={onClose}>
      <div class="form">
        <label class="sel"><span>Nombre</span><input value={v.name} placeholder="Ej: Visa Santander, Mercado Pago" onInput={(e) => setV({ ...v, name: e.currentTarget.value })} /></label>
        <div class="field-row two" style={{ paddingTop: 0 }}>
          <label class="sel"><span>Día de cierre</span><input inputmode="numeric" value={v.closeDay} onInput={(e) => setV({ ...v, closeDay: e.currentTarget.value.replace(/\D/g, '') })} /></label>
          <label class="sel"><span>Día de vencimiento</span><input inputmode="numeric" value={v.dueDay} onInput={(e) => setV({ ...v, dueDay: e.currentTarget.value.replace(/\D/g, '') })} /></label>
        </div>
        <p class="fine">Si el resumen cambia de fecha algún mes, ajustalo acá. Las cuotas ya cargadas no se mueven.</p>
        {c.id && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Eliminar</button>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}
