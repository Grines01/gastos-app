import { S, saveSettings } from './lib/store.js'
import { findDupes, explain } from './lib/dupes.js'
import { money as money0, shortDate } from './lib/format.js'
import { TxRow } from './Movs.jsx'
import { toast } from './ui.jsx'

const money = (c) => money0(c, { decimals: false })
export const dupeGroups = () => findDupes(S.txs, S.settings.dupIgnore || [])

// Grupos que incluyen un movimiento (para avisar al guardarlo)
export function dupesOf(id) { return dupeGroups().filter((g) => g.txs.some((t) => t.id === id)) }

export function DupesPage({ onEdit }) {
  const groups = dupeGroups()
  const ignore = (g) => {
    const prev = S.settings.dupIgnore || []
    saveSettings({ dupIgnore: [...prev, g.key] })
    toast('Marcado como que no es duplicado', { label: 'Deshacer', fn: () => saveSettings({ dupIgnore: prev }) })
  }
  if (!groups.length) return <p class="fine pad-x">No encontré movimientos repetidos. Se revisa solo cada vez que cargás o importás algo.</p>
  return (
    <>
      <p class="fine pad-x">Tocá un movimiento para abrirlo y borrarlo si sobra. Si no es un error (por ejemplo, dos pagos reales del mismo monto), marcalo y no vuelve a aparecer.</p>
      {groups.map((g) => (
        <section class="card dupe">
          <p class="dupe-why"><b>{explain(g, money)}</b>{g.kind === 'cuota' ? '. Si llevás las cuotas mes a mes, borrá la compra completa.' : g.kind === 'sum' ? '. Sobra el total o las partes.' : ''}</p>
          <ul class="dupe-list">{g.txs.map((t) => <TxRow t={t} onClick={() => onEdit(t)} />)}</ul>
          <div class="dupe-foot">
            <span class="fine">{g.txs.map((t) => shortDate(t.date)).filter((d, i, a) => a.indexOf(d) === i).join(' · ')}</span>
            <button class="btn ghost sm" onClick={() => ignore(g)}>No es duplicado</button>
          </div>
        </section>
      ))}
    </>
  )
}
