import { S, saveTx, remove, catById, today } from './lib/store.js'
import { money as money0, uid } from './lib/format.js'
import { openSplits, owedSummary, owedOf, isOpen, findPayment, refundCategoryId } from './lib/split.js'
import { enableNotify, notifySupported } from './Cards.jsx'
import { Icon, toast } from './ui.jsx'

const money = (c) => money0(c, { decimals: false })
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const title = (t) => t.note || catById(t.categoryId)?.name || 'Gasto compartido'
const namesText = (ns) => (ns.length <= 1 ? ns.join('') : `${ns.slice(0, -1).join(', ')} y ${ns.at(-1)}`)

// Inicio: "Te deben $X (Leo, Lucas)"
export { owedSummary }

async function setPerson(t, i, patch) {
  const people = t.split.people.map((p, k) => (k === i ? { ...p, ...patch } : p))
  await saveTx({ ...t, split: { ...t.split, people } })
}

// "Me pagó": carga el reintegro como ingreso, vinculado al gasto
async function markPaid(t, i) {
  const p = t.split.people[i]
  const t0 = today()
  const inc = await saveTx({
    id: uid(), type: 'income', date: t0 < t.date ? t.date : t0, amount: p.amount, accountId: t.accountId, toAccountId: null,
    categoryId: refundCategoryId(), tagIds: [], note: `${p.name} · ${title(t)}`, currency: 'ARS', origAmount: null, rate: null,
    source: 'manual', splitOf: t.id,
  })
  await setPerson(t, i, { paidId: inc.id, waived: false })
  toast(`Reintegro de ${p.name} cargado: ${money(p.amount)}`, { label: 'Deshacer', fn: async () => { await remove('txs', inc.id); await setPerson(S.txs.find((x) => x.id === t.id), i, { paidId: null }) } })
}
// La transferencia ya estaba (importada del banco): se vincula en vez de cargarla de nuevo
async function link(t, i, inc) {
  const before = { ...inc }
  await saveTx({ ...inc, splitOf: t.id, categoryId: inc.categoryId || refundCategoryId() })
  await setPerson(t, i, { paidId: inc.id, waived: false })
  toast(`Vinculado con la transferencia del ${ddmm(inc.date)}`, { label: 'Deshacer', fn: async () => { await saveTx(before); await setPerson(S.txs.find((x) => x.id === t.id), i, { paidId: null }) } })
}
async function waive(t, i, v = true) {
  await setPerson(t, i, { waived: v })
  if (v) toast(`${t.split.people[i].name} ya no figura como deuda`, { label: 'Deshacer', fn: () => setPerson(S.txs.find((x) => x.id === t.id), i, { waived: false }) })
}

function SplitCard({ t, onEdit }) {
  const people = t.split.people
  const mine = t.amount - people.reduce((s, p) => s + p.amount, 0)
  const owed = owedOf(t)
  return (
    <section class="card split-card">
      <button class="split-head" onClick={() => onEdit(t)}>
        <span><b>{title(t)}</b><small>{ddmm(t.date)} · total {money(t.amount)}{t.split.me ? ` · tu parte ${money(mine)}` : ''}</small></span>
        <Icon name="right" size={16} />
      </button>
      <ul class="split-people">
        {people.map((p, i) => {
          const inc = p.paidId && S.txs.find((x) => x.id === p.paidId)
          const match = isOpen(p) && findPayment(t, p)
          return (
            <li class={isOpen(p) ? '' : 'sp-done'}>
              <div class="sp-row">
                <span class="sp-name">{p.name}<small>{inc ? `Pagó el ${ddmm(inc.date)}` : p.paidId ? 'Pagó' : p.waived ? 'No te debe' : <>Te debe{!match && <> · <button class="sp-waive" onClick={() => waive(t, i)}>no me debe</button></>}</>}</small></span>
                <b class="num">{money(p.amount)}</b>
                {isOpen(p) ? <button class="btn sm primary" onClick={() => markPaid(t, i)}>Me pagó</button>
                  : inc ? <button class="sp-ok" onClick={() => onEdit(inc)} aria-label={`Ver el reintegro de ${p.name}`}>✓</button>
                  : p.waived ? <button class="link-btn inline" onClick={() => waive(t, i, false)}>Deshacer</button> : <span class="sp-ok">✓</span>}
              </div>
              {match && (
                <div class="sp-match">
                  <span>¿Es la transferencia de <b class="num">{money(match.amount)}</b> del {ddmm(match.date)}{match.rawDesc ? ` (${match.rawDesc.replace(/\s+/g, ' ').slice(0, 40)})` : ''}?</span>
                  <button class="link-btn inline" onClick={() => link(t, i, match)}>Sí, vincular</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {owed > 0 && people.filter(isOpen).length > 1 && <p class="fine split-foot">Falta cobrar {money(owed)}</p>}
    </section>
  )
}

export function DebtsPage({ onEdit }) {
  const open = openSplits().reverse() // más nuevos arriba
  const { total, names } = owedSummary()
  const since = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toLocaleDateString('sv') })()
  const closed = S.txs.filter((t) => t.type === 'expense' && t.split && !t.split.people.some(isOpen) && t.date >= since)
  const notifyOn = S.settings.notify && notifySupported() && Notification.permission === 'granted'
  return (
    <>
      {open.length === 0 ? (
        <p class="fine pad-x">Nadie te debe nada. Cuando cargues un gasto, marcá <b>Compartido</b> y escribí con quién dividiste la cuenta: acá vas a ver quién te pagó.</p>
      ) : (
        <div class="tiles fut-tiles">
          <div class="tile"><span class="tile-l">Te deben</span><b class="tile-v num">{money(total)}</b><span class="tile-s">{namesText(names)}</span></div>
        </div>
      )}
      {open.map((t) => <SplitCard t={t} onEdit={onEdit} />)}
      {open.length > 0 && <p class="fine pad-x">"Me pagó" carga el reintegro como ingreso (Cashback) con fecha de hoy; lo podés abrir con ✓ para cambiar la fecha o la cuenta. Si importás el extracto y la transferencia ya está, te propongo vincularla para no contarla dos veces.</p>}
      {open.length > 0 && !notifyOn && notifySupported() && Notification.permission !== 'denied' && (
        <section class="card">
          <h2>Avisos</h2>
          <p class="fine">Activalos y a los 2 días de un gasto compartido te pregunto si ya te pagaron.</p>
          <button class="btn primary" onClick={enableNotify}>Activar avisos</button>
        </section>
      )}
      {closed.length > 0 && (
        <details class="proj-table split-closed pad-x">
          <summary>Saldados ({closed.length})</summary>
          {[...closed].reverse().map((t) => <SplitCard t={t} onEdit={onEdit} />)}
        </details>
      )}
    </>
  )
}
