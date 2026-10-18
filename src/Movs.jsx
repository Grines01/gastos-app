import { useState } from 'preact/hooks'
import { S, catById, accById, tagById } from './lib/store.js'
import { range, inRange } from './lib/period.js'
import { money, dayLabel, norm } from './lib/format.js'
import { NEUTRAL } from './lib/defaults.js'
import { PeriodBar } from './PeriodBar.jsx'
import { Icon, Empty } from './ui.jsx'

export function Movs({ period, setPeriod, filter, setFilter, onEdit, onImport }) {
  const [limit, setLimit] = useState(200)
  const rg = range(period)
  const q = norm(filter.q || '')
  const txs = S.txs.filter((t) => {
    if (!inRange(t.date, rg)) return false
    if (filter.type !== 'all' && t.type !== filter.type) return false
    if (filter.categoryId === 'none' ? (t.type === 'transfer' || t.categoryId) : filter.categoryId && t.categoryId !== filter.categoryId) return false
    if (filter.accountId && t.accountId !== filter.accountId && t.toAccountId !== filter.accountId) return false
    if (filter.tagId && !(t.tagIds || []).includes(filter.tagId)) return false
    if (q) {
      const hay = norm(`${t.note} ${t.rawDesc || ''} ${catById(t.categoryId)?.name || ''} ${(t.tagIds || []).map((id) => tagById(id)?.name).join(' ')}`)
      if (!hay.includes(q)) return false
    }
    return true
  })
  const exp = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const inc = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const uncat = S.txs.filter((t) => inRange(t.date, rg) && t.type !== 'transfer' && !t.categoryId).length

  const groups = []
  for (const t of txs.slice(0, limit)) {
    let g = groups[groups.length - 1]
    if (!g || g.date !== t.date) { g = { date: t.date, items: [], net: 0 }; groups.push(g) }
    g.items.push(t)
    g.net += t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0
  }
  const cats = S.categories.filter((c) => !c.archived && (filter.type === 'all' || c.kind === filter.type))
  const set = (patch) => { setFilter({ ...filter, ...patch }); setLimit(200) }
  const active = filter.categoryId || filter.accountId || filter.tagId || filter.type !== 'all'

  return (
    <main class="screen">
      <header class="top">
        <div class="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Buscar por nota, comercio o etiqueta" value={filter.q || ''} onInput={(e) => set({ q: e.currentTarget.value })} />
        </div>
        <button class="icon-btn" onClick={onImport} aria-label="Importar archivo" title="Importar archivo"><Icon name="upload" /></button>
      </header>
      <PeriodBar period={period} setPeriod={setPeriod} />
      <div class="filters">
        <select value={filter.type} onChange={(e) => set({ type: e.currentTarget.value, categoryId: null })} aria-label="Tipo">
          <option value="all">Todos</option><option value="expense">Gastos</option><option value="income">Ingresos</option><option value="transfer">Transferencias</option>
        </select>
        <select value={filter.categoryId || ''} onChange={(e) => set({ categoryId: e.currentTarget.value || null })} aria-label="Categoría">
          <option value="">Categoría</option><option value="none">Sin categoría</option>
          {cats.map((c) => <option value={c.id}>{c.name}</option>)}
        </select>
        <select value={filter.accountId || ''} onChange={(e) => set({ accountId: e.currentTarget.value || null })} aria-label="Cuenta">
          <option value="">Cuenta</option>{S.accounts.map((a) => <option value={a.id}>{a.name}</option>)}
        </select>
        <select value={filter.tagId || ''} onChange={(e) => set({ tagId: e.currentTarget.value || null })} aria-label="Etiqueta">
          <option value="">Etiqueta</option>{S.tags.map((t) => <option value={t.id}>{t.name}</option>)}
        </select>
        {active && <button class="link-btn" onClick={() => set({ type: 'all', categoryId: null, accountId: null, tagId: null })}>Limpiar</button>}
      </div>
      {uncat > 0 && filter.categoryId !== 'none' && (
        <button class="notice" onClick={() => set({ categoryId: 'none', type: 'all' })}>
          {uncat === 1 ? 'Hay 1 movimiento sin categoría' : `Hay ${uncat} movimientos sin categoría`} en este período. Ver y categorizar
        </button>
      )}
      <div class="sum-line">
        <span>{txs.length} movimientos</span>
        <span>Ingresos <b class="num pos">{money(inc)}</b></span>
        <span>Gastos <b class="num">{money(exp)}</b></span>
      </div>

      {txs.length === 0 ? <Empty title="No hay movimientos con estos filtros" /> : groups.map((g) => (
        <section class="day">
          <h3><span>{dayLabel(g.date)}</span><span class={`num ${g.net >= 0 ? 'pos' : ''}`}>{g.net === 0 ? '' : money(g.net, { sign: g.net < 0 ? '−' : '+' })}</span></h3>
          <ul>{g.items.map((t) => <TxRow t={t} onClick={() => onEdit(t)} />)}</ul>
        </section>
      ))}
      {txs.length > limit && <button class="btn ghost wide" onClick={() => setLimit(limit + 300)}>Ver más ({txs.length - limit})</button>}
    </main>
  )
}

export function TxRow({ t, onClick }) {
  const c = catById(t.categoryId)
  const isT = t.type === 'transfer'
  const title = isT ? `${accById(t.accountId)?.name || '?'} → ${accById(t.toAccountId)?.name || '?'}` : c?.name || 'Sin categoría'
  const sub = [t.note, ...(t.tagIds || []).map((id) => tagById(id)?.name).filter(Boolean).map((n) => `#${n}`)].filter(Boolean).join('  ')
  return (
    <li>
      <button class={`tx-row${!isT && !c ? ' uncat' : ''}`} onClick={onClick}>
        <span class="tx-ico" style={{ '--c': isT ? NEUTRAL : c?.color || NEUTRAL }} aria-hidden="true">{isT ? '⇄' : c?.emoji || '❔'}</span>
        <span class="tx-main"><span class="tx-title">{title}</span>{sub && <span class="tx-sub">{sub}</span>}</span>
        <span class="tx-amt">
          <span class={`num ${t.type === 'income' ? 'pos' : ''}`}>{money(t.amount, { sign: t.type === 'expense' ? '−' : t.type === 'income' ? '+' : '' })}</span>
          {t.currency === 'USD' && <small class="num">US$ {(t.origAmount / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</small>}
        </span>
      </button>
    </li>
  )
}
