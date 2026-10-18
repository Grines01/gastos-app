import { useEffect, useRef, useState } from 'preact/hooks'
import { S, saveTx, remove, defaultAccountId, saveSettings } from './lib/store.js'
import { money, parseAmount, today, addDays } from './lib/format.js'
import { fetchRate, RATE_KINDS } from './lib/rates.js'
import { Sheet, Seg, Icon, toast } from './ui.jsx'

const TYPE_LABEL = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' }

export function TxSheet({ open, tx, initialType = 'expense', onClose }) {
  const editing = !!tx?.id
  const [type, setType] = useState(initialType)
  const [amountStr, setAmountStr] = useState('')
  const [currency, setCurrency] = useState('ARS')
  const [rateStr, setRateStr] = useState('')
  const [rateState, setRateState] = useState('idle')
  const [date, setDate] = useState(today())
  const [accountId, setAccountId] = useState(defaultAccountId())
  const [toAccountId, setToAccountId] = useState(null)
  const [categoryId, setCategoryId] = useState(null)
  const [tagIds, setTagIds] = useState([])
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const amountRef = useRef()

  useEffect(() => {
    if (!open) return
    const t = tx || {}
    setType(t.type || initialType)
    setCurrency(t.currency || 'ARS')
    setAmountStr(t.id ? fmtInput(t.currency === 'USD' ? t.origAmount : t.amount) : '')
    setRateStr(t.rate ? String(t.rate).replace('.', ',') : '')
    setRateState('idle')
    setDate(t.date || today())
    setAccountId(t.accountId || defaultAccountId())
    setToAccountId(t.toAccountId || S.accounts.find((a) => a.id !== (t.accountId || defaultAccountId()) && !a.archived)?.id || null)
    setCategoryId(t.categoryId || null)
    setTagIds(t.tagIds || [])
    setNote(t.note || '')
    setMore(!!(t.id && (t.note || t.tagIds?.length)))
    setTimeout(() => amountRef.current?.focus(), 60)
  }, [open, tx])

  // cotización automática al elegir USD
  useEffect(() => {
    if (!open || currency !== 'USD' || (editing && rateStr && rateState === 'idle')) return
    let alive = true
    setRateState('loading')
    const side = type === 'income' ? 'compra' : 'venta'
    fetchRate(S.settings.rateKind || 'bolsa', date, side)
      .then((v) => { if (alive) { setRateStr(String(v).replace('.', ',')); setRateState('ok') } })
      .catch(() => { if (alive) setRateState('error') })
    return () => { alive = false }
  }, [open, currency, date, type])

  const raw = parseAmount(amountStr)
  const rate = parseFloat(String(rateStr).replace(/\./g, '').replace(',', '.'))
  const ars = currency === 'USD' ? (Number.isFinite(raw) && rate > 0 ? Math.round(Math.abs(raw) * rate) : NaN) : Math.abs(raw)
  const valid = Number.isFinite(ars) && ars > 0
  const cats = S.categories.filter((c) => c.kind === type && !c.archived)
  const accounts = S.accounts.filter((a) => !a.archived)

  async function save(catId = categoryId) {
    if (!valid) { amountRef.current?.focus(); toast('Escribí un monto'); return }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) { toast('Elegí una cuenta de destino distinta'); return }
    const obj = {
      ...(tx || {}), type, date, amount: ars, accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      categoryId: type === 'transfer' ? null : catId, tagIds, note: note.trim(),
      currency, origAmount: currency === 'USD' ? Math.abs(raw) : null, rate: currency === 'USD' ? rate : null,
      source: tx?.source || 'manual',
    }
    const saved = await saveTx(obj)
    if (accountId !== S.settings.defaultAccountId) saveSettings({ defaultAccountId: accountId })
    onClose()
    if (editing) toast('Cambios guardados')
    else toast(`${TYPE_LABEL[type]} guardado`, { label: 'Deshacer', fn: () => remove('txs', saved.id) })
  }

  async function del() {
    const copy = { ...tx }
    await remove('txs', tx.id)
    onClose()
    toast('Movimiento eliminado', { label: 'Deshacer', fn: () => saveTx(copy) })
  }

  const pickCat = (id) => { setCategoryId(id); if (!editing && valid) save(id) }
  const toggleTag = (id) => setTagIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))

  return (
    <Sheet open={open} onClose={onClose} title={editing ? `Editar ${TYPE_LABEL[type].toLowerCase()}` : null} full>
      {!editing && (
        <div class="sheet-head">
          <Seg value={type} onChange={(v) => { setType(v); setCategoryId(null) }} options={[{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }, { value: 'transfer', label: 'Transferencia' }]} />
          <button class="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
        </div>
      )}
      <div class="tx-body">
        <div class={`amount-row t-${type}`}>
          <button class="cur" onClick={() => setCurrency(currency === 'ARS' ? 'USD' : 'ARS')} aria-label="Cambiar moneda">{currency === 'ARS' ? '$' : 'US$'}</button>
          <input ref={amountRef} class="amount-input num" inputmode="decimal" enterkeyhint="done" placeholder="0" value={amountStr}
            onInput={(e) => setAmountStr(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && (type === 'transfer' || editing || categoryId) && save()} aria-label="Monto" />
        </div>
        {currency === 'USD' && (
          <div class="rate-row">
            <label>Cotización {RATE_KINDS.find((k) => k.id === (S.settings.rateKind || 'bolsa'))?.name}
              <input inputmode="decimal" value={rateStr} onInput={(e) => { setRateStr(e.currentTarget.value); setRateState('manual') }} placeholder="—" />
            </label>
            <span class="rate-info">
              {rateState === 'loading' ? 'Buscando cotización…' : rateState === 'error' && !rateStr ? 'Sin conexión: escribila a mano' : valid ? `= ${money(ars)}` : ''}
            </span>
          </div>
        )}

        <div class="field-row">
          <div class="chips">
            <button class={`chip${date === today() ? ' on' : ''}`} onClick={() => setDate(today())}>Hoy</button>
            <button class={`chip${date === addDays(today(), -1) ? ' on' : ''}`} onClick={() => setDate(addDays(today(), -1))}>Ayer</button>
            <label class={`chip date-chip${date < addDays(today(), -1) || date > today() ? ' on' : ''}`}>
              <input type="date" value={date} onInput={(e) => e.currentTarget.value && setDate(e.currentTarget.value)} aria-label="Fecha" />
            </label>
          </div>
        </div>

        <div class="field-row two">
          <label class="sel"><span>{type === 'transfer' ? 'Desde' : 'Cuenta'}</span>
            <select value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>{accounts.map((a) => <option value={a.id}>{a.name}</option>)}</select>
          </label>
          {type === 'transfer' && (
            <label class="sel"><span>Hacia</span>
              <select value={toAccountId || ''} onChange={(e) => setToAccountId(e.currentTarget.value)}>{accounts.map((a) => <option value={a.id}>{a.name}</option>)}</select>
            </label>
          )}
          {type !== 'transfer' && <button class="link-btn" onClick={() => setMore(!more)}>{more ? 'Menos opciones' : 'Nota y etiquetas'}</button>}
        </div>

        {(more || type === 'transfer') && (
          <div class="more-box">
            <input class="text-input" placeholder="Nota (opcional)" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            {type !== 'transfer' && S.tags.length > 0 && (
              <div class="chips wrap">{S.tags.map((t) => <button class={`chip${tagIds.includes(t.id) ? ' on' : ''}`} onClick={() => toggleTag(t.id)}>{t.name}</button>)}</div>
            )}
          </div>
        )}

        {type !== 'transfer' ? (
          <>
            <p class="hint">{editing ? 'Categoría' : valid ? 'Tocá una categoría para guardar' : 'Escribí el monto y tocá una categoría'}</p>
            <div class="cat-grid">
              {cats.map((c) => (
                <button class={`cat-btn${categoryId === c.id ? ' on' : ''}`} onClick={() => pickCat(c.id)} style={{ '--c': c.color }}>
                  <span class="cat-emoji" aria-hidden="true">{c.emoji || '•'}</span>
                  <span class="cat-name">{c.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {(editing || type === 'transfer') && (
        <div class="sheet-foot">
          {editing && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Eliminar</button>}
          <button class="btn primary" onClick={() => save()}>{editing ? 'Guardar cambios' : 'Guardar transferencia'}</button>
        </div>
      )}
    </Sheet>
  )
}

function fmtInput(cents) {
  if (cents == null) return ''
  const v = cents / 100
  return v.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}
