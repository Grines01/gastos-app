import { useState, useEffect } from 'preact/hooks'
import { S, put, remove, exportData, importData, saveSettings, undoBatch, balances, catById, accById, wipeAll, requestPersist } from './lib/store.js'
import { money, parseAmount, today } from './lib/format.js'
import { toCSV } from './lib/importer.js'
import { RATE_KINDS } from './lib/rates.js'
import { PALETTE, EMOJI_CHOICES, colorFor } from './lib/defaults.js'
import { Icon, Seg, Sheet, toast, download, confirmDialog } from './ui.jsx'

export function More({ page, setPage, onImport }) {
  if (page === 'accounts') return <Sub title="Cuentas" back={() => setPage(null)}><Accounts /></Sub>
  if (page === 'categories') return <Sub title="Categorías" back={() => setPage(null)}><Categories /></Sub>
  if (page === 'tags') return <Sub title="Etiquetas" back={() => setPage(null)}><Tags /></Sub>
  if (page === 'rules') return <Sub title="Reglas de importación" back={() => setPage(null)}><Rules /></Sub>
  if (page === 'batches') return <Sub title="Importaciones" back={() => setPage(null)}><Batches /></Sub>
  if (page === 'data') return <Sub title="Backup y datos" back={() => setPage(null)}><Data /></Sub>
  const last = S.settings.lastBackupAt
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null
  return (
    <main class="screen">
      <header class="top"><h1>Más</h1></header>
      <button class="big-action" onClick={onImport}>
        <Icon name="upload" size={26} />
        <span><b>Importar movimientos</b><small>Extracto de Santander, export de Gestor de gastos o CSV</small></span>
      </button>
      {(days === null || days >= 7) && S.txs.length > 0 && (
        <button class="notice" onClick={() => setPage('data')}>{days === null ? 'Nunca hiciste un backup.' : `Tu último backup es de hace ${days} días.`} Tus datos solo están en este teléfono: hacé uno ahora.</button>
      )}
      <ul class="menu">
        <li><button onClick={() => setPage('accounts')}><span>Cuentas</span><small>{S.accounts.filter((a) => !a.archived).length}</small><Icon name="right" size={18} /></button></li>
        <li><button onClick={() => setPage('categories')}><span>Categorías</span><small>{S.categories.filter((c) => !c.archived).length}</small><Icon name="right" size={18} /></button></li>
        <li><button onClick={() => setPage('tags')}><span>Etiquetas</span><small>{S.tags.length}</small><Icon name="right" size={18} /></button></li>
        <li><button onClick={() => setPage('rules')}><span>Reglas de importación</span><small>{S.rules.length}</small><Icon name="right" size={18} /></button></li>
        <li><button onClick={() => setPage('batches')}><span>Importaciones</span><small>{S.batches.length}</small><Icon name="right" size={18} /></button></li>
        <li><button onClick={() => setPage('data')}><span>Backup y datos</span><Icon name="right" size={18} /></button></li>
      </ul>
      <section class="card">
        <h2>Dólar</h2>
        <p class="fine">Cotización que se usa al cargar en USD. Ingresos usan el precio de compra y gastos el de venta. Siempre la podés editar.</p>
        <Seg small value={S.settings.rateKind || 'bolsa'} onChange={(v) => saveSettings({ rateKind: v })} options={RATE_KINDS.map((k) => ({ value: k.id, label: k.name }))} />
      </section>
      <p class="fine center">{S.txs.length} movimientos guardados en este teléfono</p>
    </main>
  )
}

function Sub({ title, back, children }) {
  return (
    <main class="screen">
      <header class="top"><button class="icon-btn" onClick={back} aria-label="Volver"><Icon name="back" /></button><h1>{title}</h1></header>
      {children}
    </main>
  )
}

// ---------- Cuentas ----------
function Accounts() {
  const [edit, setEdit] = useState(null)
  const bal = balances()
  return (
    <>
      <ul class="menu">
        {S.accounts.map((a) => (
          <li><button onClick={() => setEdit(a)}><span>{a.name}{a.archived ? ' (archivada)' : ''}{S.settings.defaultAccountId === a.id ? <em class="badge">predeterminada</em> : null}</span><small class="num">{money(bal[a.id] || 0, { sign: (bal[a.id] || 0) < 0 ? '−' : '' })}</small></button></li>
        ))}
      </ul>
      <button class="btn ghost wide" onClick={() => setEdit({ name: '', initial: 0, order: S.accounts.length })}><Icon name="plus" size={18} /> Nueva cuenta</button>
      <AccountSheet a={edit} onClose={() => setEdit(null)} />
    </>
  )
}
function AccountSheet({ a, onClose }) {
  const [name, setName] = useState('')
  const [initial, setInitial] = useState('')
  useEffect(() => { if (a) { setName(a.name); setInitial(a.initial ? String(a.initial / 100).replace('.', ',') : '') } }, [a])
  if (!a) return null
  const used = a.id && S.txs.some((t) => t.accountId === a.id || t.toAccountId === a.id)
  const save = async () => {
    if (!name.trim()) return toast('Poné un nombre')
    const v = initial.trim() ? parseAmount(initial) : 0
    if (!Number.isFinite(v)) return toast('El saldo inicial no es un número')
    await put('accounts', { ...a, name: name.trim(), initial: v }); onClose()
  }
  return (
    <Sheet open title={a.id ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose}>
      <div class="form">
        <label class="sel"><span>Nombre</span><input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Ej: Caja diaria, Ahorros" /></label>
        <label class="sel"><span>Saldo inicial</span><input inputmode="decimal" value={initial} onInput={(e) => setInitial(e.currentTarget.value)} placeholder="0" /></label>
        <p class="fine">El saldo se calcula como saldo inicial más ingresos menos gastos, con las transferencias.</p>
        {a.id && <button class="btn ghost" onClick={() => { saveSettings({ defaultAccountId: a.id }); onClose() }}>Usar como predeterminada</button>}
        {a.id && <button class="btn ghost" onClick={async () => { await put('accounts', { ...a, archived: !a.archived }); onClose() }}>{a.archived ? 'Desarchivar' : 'Archivar'}</button>}
        {a.id && !used && <button class="btn ghost danger" onClick={async () => { await remove('accounts', a.id); onClose() }}>Eliminar</button>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}

// ---------- Categorías ----------
function Categories() {
  const [kind, setKind] = useState('expense')
  const [edit, setEdit] = useState(null)
  const list = S.categories.filter((c) => c.kind === kind)
  const move = async (c, dir) => {
    const i = list.indexOf(c), j = i + dir
    if (j < 0 || j >= list.length) return
    const o = list[j]
    await put('categories', { ...c, order: o.order }); await put('categories', { ...o, order: c.order })
  }
  return (
    <>
      <div class="pad-x"><Seg value={kind} onChange={setKind} options={[{ value: 'expense', label: 'De gastos' }, { value: 'income', label: 'De ingresos' }]} /></div>
      <ul class="menu">
        {list.map((c) => (
          <li class="cat-edit-row">
            <button onClick={() => setEdit(c)}><span><i class="dot" style={{ background: c.color }} /> {c.emoji} {c.name}{c.archived ? ' (archivada)' : ''}</span></button>
            <span class="order-btns">
              <button class="icon-btn sm" onClick={() => move(c, -1)} aria-label="Subir">↑</button>
              <button class="icon-btn sm" onClick={() => move(c, 1)} aria-label="Bajar">↓</button>
            </span>
          </li>
        ))}
      </ul>
      <button class="btn ghost wide" onClick={() => setEdit({ kind, name: '', emoji: '🏷️', color: colorFor(list.length), order: (list[list.length - 1]?.order ?? -1) + 1 })}><Icon name="plus" size={18} /> Nueva categoría</button>
      <CategorySheet c={edit} onClose={() => setEdit(null)} />
    </>
  )
}
function CategorySheet({ c, onClose }) {
  const [v, setV] = useState(null)
  useEffect(() => { setV(c ? { ...c } : null) }, [c])
  if (!c || !v) return null
  const count = c.id ? S.txs.filter((t) => t.categoryId === c.id).length : 0
  const save = async () => { if (!v.name.trim()) return toast('Poné un nombre'); await put('categories', { ...v, name: v.name.trim() }); onClose() }
  return (
    <Sheet open title={c.id ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <div class="form">
        <label class="sel"><span>Nombre</span><input value={v.name} onInput={(e) => setV({ ...v, name: e.currentTarget.value })} /></label>
        <span class="lbl">Ícono</span>
        <div class="emoji-grid">{EMOJI_CHOICES.map((e) => <button class={v.emoji === e ? 'on' : ''} onClick={() => setV({ ...v, emoji: e })}>{e}</button>)}</div>
        <span class="lbl">Color</span>
        <div class="color-grid">{PALETTE.map((col) => <button class={v.color === col ? 'on' : ''} style={{ background: col }} onClick={() => setV({ ...v, color: col })} aria-label={col} />)}</div>
        {c.id && <button class="btn ghost" onClick={async () => { await put('categories', { ...v, archived: !v.archived }); onClose() }}>{v.archived ? 'Desarchivar' : 'Archivar (deja de aparecer al cargar)'}</button>}
        {c.id && count === 0 && <button class="btn ghost danger" onClick={async () => { await remove('categories', c.id); onClose() }}>Eliminar</button>}
        {c.id && count > 0 && <p class="fine">Tiene {count} movimientos: la podés archivar, no eliminar.</p>}
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}

// ---------- Etiquetas ----------
function Tags() {
  const [name, setName] = useState('')
  const add = async () => { const n = name.trim(); if (!n) return; if (S.tags.some((t) => t.name.toLowerCase() === n.toLowerCase())) return toast('Ya existe'); await put('tags', { name: n }); setName('') }
  return (
    <>
      <div class="inline-form pad-x"><input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Nueva etiqueta" onKeyDown={(e) => e.key === 'Enter' && add()} /><button class="btn primary" onClick={add}>Agregar</button></div>
      <ul class="menu">
        {S.tags.map((t) => {
          const n = S.txs.filter((x) => (x.tagIds || []).includes(t.id)).length
          return (
            <li><div class="row-static"><span>#{t.name}</span><small>{n} usos</small>
              <button class="icon-btn sm" aria-label="Renombrar" onClick={async () => { const v = prompt('Nuevo nombre', t.name); if (v && v.trim()) await put('tags', { ...t, name: v.trim() }) }}>✎</button>
              <button class="icon-btn sm" aria-label="Eliminar" onClick={async () => { if (n === 0 || confirmDialog(`Se quita de ${n} movimientos. ¿Eliminar #${t.name}?`)) { for (const x of S.txs.filter((x) => (x.tagIds || []).includes(t.id))) await put('txs', { ...x, tagIds: x.tagIds.filter((i) => i !== t.id) }); await remove('tags', t.id) } }}><Icon name="trash" size={16} /></button>
            </div></li>
          )
        })}
      </ul>
    </>
  )
}

// ---------- Reglas ----------
function Rules() {
  if (!S.rules.length) return <p class="fine pad-x">Todavía no hay reglas. Se crean solas cuando corregís la categoría de un movimiento al importar.</p>
  const label = (r) => r.action === 'skip' ? 'Ignorar' : r.action === 'transfer' ? `Transferencia a ${accById(r.toAccountId)?.name || '?'}` : catById(r.categoryId) ? `${catById(r.categoryId).emoji} ${catById(r.categoryId).name}` : '?'
  return (
    <>
      <p class="fine pad-x">Si la descripción del banco contiene el texto de la izquierda, el movimiento se propone así.</p>
      <ul class="menu">
        {[...S.rules].sort((a, b) => a.pattern.localeCompare(b.pattern)).map((r) => (
          <li><div class="row-static"><span class="rule-pat">{r.pattern}</span><small>{label(r)}{r.note ? ` (${r.note})` : ''}</small>
            <button class="icon-btn sm" aria-label="Eliminar regla" onClick={() => remove('rules', r.id)}><Icon name="trash" size={16} /></button></div></li>
        ))}
      </ul>
    </>
  )
}

// ---------- Importaciones ----------
function Batches() {
  if (!S.batches.length) return <p class="fine pad-x">Todavía no importaste nada.</p>
  return (
    <ul class="menu">
      {[...S.batches].sort((a, b) => b.createdAt - a.createdAt).map((b) => (
        <li><div class="row-static"><span>{b.fileName || 'Archivo'}<small>{new Date(b.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}, {b.count} movimientos</small></span>
          <button class="btn ghost sm" onClick={async () => { if (confirmDialog(`Se borran los ${b.count} movimientos de esta importación. ¿Deshacer?`)) { const n = await undoBatch(b.id); toast(`Importación deshecha: ${n} movimientos borrados`) } }}><Icon name="undo" size={16} /> Deshacer</button></div></li>
      ))}
    </ul>
  )
}

// ---------- Datos ----------
function Data() {
  const backup = async () => {
    await download(`gastos-backup-${today()}.json`, JSON.stringify(exportData()))
    saveSettings({ lastBackupAt: Date.now() })
  }
  const restore = async (f) => {
    try {
      const data = JSON.parse(await f.text())
      if (!confirmDialog(`Esto reemplaza todo lo que hay en la app por el backup (${data.txs?.length ?? 0} movimientos). ¿Seguir?`)) return
      await importData(data); toast('Backup restaurado')
    } catch (e) { toast(e.message || 'No pude leer el backup') }
  }
  return (
    <div class="pad-x stack">
      <section class="card">
        <h2>Backup</h2>
        <p class="fine">Guarda todo (movimientos, cuentas, categorías, etiquetas y reglas) en un archivo. Guardalo en Drive o mandátelo por mail: si borrás la app o cambiás de teléfono, lo restaurás desde acá.</p>
        <button class="btn primary" onClick={backup}><Icon name="download" size={18} /> Hacer backup</button>
        {S.settings.lastBackupAt && <p class="fine">Último: {new Date(S.settings.lastBackupAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        <label class="btn ghost file-btn">Restaurar un backup<input type="file" accept=".json,application/json" onChange={(e) => e.currentTarget.files[0] && restore(e.currentTarget.files[0])} /></label>
      </section>
      <section class="card">
        <h2>Exportar a planilla</h2>
        <p class="fine">Todos los movimientos en CSV, para abrir en Excel o Google Sheets. Se puede volver a importar.</p>
        <button class="btn ghost" onClick={() => download(`movimientos-${today()}.csv`, '﻿' + toCSV([...S.txs].reverse()), 'text/csv')}>Exportar CSV</button>
      </section>
      <section class="card">
        <h2>Almacenamiento</h2>
        <p class="fine">{S.persisted ? 'El teléfono marcó los datos de la app como persistentes: no los borra para liberar espacio.' : 'El teléfono todavía no marcó los datos como persistentes. Instalar la app en la pantalla de inicio suele activarlo.'}</p>
        {!S.persisted && <button class="btn ghost" onClick={requestPersist}>Pedir almacenamiento persistente</button>}
      </section>
      <section class="card">
        <h2>Borrar todo</h2>
        <p class="fine">Deja la app vacía, como recién instalada.</p>
        <button class="btn ghost danger" onClick={async () => { if (confirmDialog('Se borran todos los datos de este teléfono. ¿Hiciste un backup?') && confirmDialog('¿Seguro? No se puede deshacer.')) { await wipeAll(); toast('Datos borrados') } }}>Borrar todos los datos</button>
      </section>
    </div>
  )
}
