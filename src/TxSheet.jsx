import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { S, saveTx, remove, defaultAccountId, saveSettings, bulkAddTxs, removeTxs, catById } from './lib/store.js'
import { money, parseAmount, today, addDays, uid } from './lib/format.js'
import { installmentDates, splitAmount } from './lib/cards.js'
import { fetchRate, RATE_KINDS } from './lib/rates.js'
import { Sheet, Seg, Icon, toast } from './ui.jsx'
import { dupesOf } from './Dupes.jsx'

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
  const [inst, setInst] = useState(false) // compra en cuotas
  const [nInst, setNInst] = useState(3)
  const [cardId, setCardId] = useState(null)
  const amountRef = useRef()

  // se inicializa antes de pintar: así no se ve un instante el movimiento anterior ni se pisa lo que ya escribiste
  useLayoutEffect(() => {
    if (!open) return
    const t = tx || {}
    setType(t.type || initialType)
    setCurrency(t.currency || 'ARS')
    setAmountStr(t.id || t.amount ? fmtInput(t.currency === 'USD' ? t.origAmount : t.amount) : '') // también si viene precargado ("Ya lo pagué")
    setRateStr(t.rate ? String(t.rate).replace('.', ',') : '')
    setRateState('idle')
    setDate(t.date || today())
    setAccountId(t.accountId || defaultAccountId())
    setToAccountId(t.toAccountId || S.accounts.find((a) => a.id !== (t.accountId || defaultAccountId()) && !a.archived)?.id || null)
    setCategoryId(t.categoryId || null)
    setTagIds(t.tagIds || [])
    setNote(t.note || '')
    setMore(!!(t.id && (t.note || t.tagIds?.length)))
    setInst(false); setNInst(3)
    setCardId(S.cards.find((c) => c.id === S.settings.lastCardId)?.id || S.cards[0]?.id || null)
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
  const rate = parseAmount(rateStr) / 100
  const ars = currency === 'USD' ? (Number.isFinite(raw) && rate > 0 ? Math.round(Math.abs(raw) * rate) : NaN) : Math.abs(raw)
  const valid = Number.isFinite(ars) && ars > 0
  const cats = S.categories.filter((c) => c.kind === type && !c.archived)
  const accounts = S.accounts.filter((a) => !a.archived)
  const ready = valid && (editing || type === 'transfer' || !!categoryId)
  const canInst = !editing && type === 'expense' && currency === 'ARS'
  const useInst = canInst && inst
  const card = S.cards.find((c) => c.id === cardId) || null
  const instDates = useInst ? installmentDates(date, nInst, card) : []
  const instParts = useInst && valid ? splitAmount(ars, nInst) : []
  const siblings = editing && tx.installment ? S.txs.filter((t) => t.installment?.group === tx.installment.group) : []
  const later = siblings.filter((t) => t.installment.k >= tx.installment.k)

  async function saveInstallments(catId) {
    const group = uid()
    const base = note.trim() || catById(catId)?.name || 'Compra'
    const txs = instDates.map((d, k) => ({
      id: uid(), type: 'expense', date: d, amount: instParts[k], accountId, toAccountId: null,
      categoryId: catId, tagIds, note: `${base} (cuota ${k + 1}/${nInst})`, currency: 'ARS', origAmount: null, rate: null,
      source: 'manual', createdAt: Date.now() + k, updatedAt: Date.now(),
      installment: { group, k: k + 1, n: nInst, total: ars, cardId: card?.id || null, purchase: date },
    }))
    await bulkAddTxs(txs)
    saveSettings({ ...(card ? { lastCardId: card.id } : {}), ...(accountId !== S.settings.defaultAccountId ? { defaultAccountId: accountId } : {}) })
    onClose()
    toast(`${nInst} cuotas cargadas: la primera el ${ddmm(instDates[0])}`, { label: 'Deshacer', fn: () => removeTxs(txs.map((t) => t.id)) })
  }

  async function delLater() {
    const copies = later.map((t) => ({ ...t }))
    await removeTxs(later.map((t) => t.id))
    onClose()
    toast(later.length === 1 ? 'Cuota eliminada' : `${later.length} cuotas eliminadas`, { label: 'Deshacer', fn: () => bulkAddTxs(copies) })
  }

  async function save(catId = categoryId) {
    if (!valid) { amountRef.current?.focus(); toast('Escribí un monto'); return }
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) { toast('Elegí una cuenta de destino distinta'); return }
    if (type !== 'transfer' && !editing && !catId) { toast('Elegí una categoría'); return }
    if (useInst) return saveInstallments(catId)
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
    const other = !editing && dupesOf(saved.id)[0]?.txs.find((t) => t.id !== saved.id)
    if (editing) toast('Cambios guardados')
    else if (other) toast(`¿Repetido? Ya hay ${money(other.amount, { decimals: false })} el ${other.date.slice(8)}/${other.date.slice(5, 7)}${other.note ? ` (${other.note.slice(0, 24)})` : ''}`, { label: 'Deshacer', fn: () => remove('txs', saved.id) })
    else toast(`${TYPE_LABEL[type]} guardado`, { label: 'Deshacer', fn: () => remove('txs', saved.id) })
  }

  async function del() {
    const copy = { ...tx }
    await remove('txs', tx.id)
    onClose()
    toast('Movimiento eliminado', { label: 'Deshacer', fn: () => saveTx(copy) })
  }

  const pickCat = (id) => setCategoryId(id)
  const toggleTag = (id) => setTagIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Editar movimiento' : null} full>
      {editing && (
        <div class="pad-x edit-type">
          <Seg small value={type} onChange={(v) => { setType(v); if (v !== tx.type) setCategoryId(null); else setCategoryId(tx.categoryId) }} options={[{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }, { value: 'transfer', label: 'Transferencia' }]} />
        </div>
      )}
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
            onInput={(e) => setAmountStr(e.currentTarget.value)} onKeyDown={(e) => { if (e.key !== 'Enter') return; if (type === 'transfer' || editing) save(); else e.currentTarget.blur() }} aria-label="Monto" />
        </div>
        {editing && tx.rawDesc && tx.rawDesc !== tx.note && <p class="fine raw-desc">Del extracto: {tx.rawDesc}</p>}
        {editing && tx.installment && (
          <p class="fine raw-desc">
            Cuota {tx.installment.k} de {tx.installment.n}{S.cards.find((c) => c.id === tx.installment.cardId) ? ` · ${S.cards.find((c) => c.id === tx.installment.cardId).name}` : ''} · compra del {ddmm(tx.installment.purchase)} por {money(tx.installment.total)}.
            {later.length > 1 && <> <button class="link-btn inline" onClick={delLater}>Eliminar esta y las {later.length - 1} siguientes</button></>}
          </p>
        )}
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

        {canInst && (
          <div class="inst-box">
            <label class="remember inst-toggle"><input type="checkbox" checked={inst} onChange={(e) => setInst(e.currentTarget.checked)} /> En cuotas</label>
            {inst && (
              <>
                <div class="field-row two inst-row">
                  <label class="sel"><span>Cuotas</span>
                    <select value={nInst} onChange={(e) => setNInst(Number(e.currentTarget.value))}>{[2, 3, 4, 5, 6, 9, 10, 12, 18, 24].map((n) => <option value={n}>{n}</option>)}</select>
                  </label>
                  <label class="sel"><span>Tarjeta</span>
                    <select value={cardId || ''} onChange={(e) => setCardId(e.currentTarget.value || null)}>
                      {S.cards.map((c) => <option value={c.id}>{c.name}</option>)}
                      <option value="">Sin tarjeta</option>
                    </select>
                  </label>
                </div>
                <p class="fine inst-preview">
                  {valid ? <><b class="num">{nInst} cuotas de {money(instParts[0])}</b> (total {money(ars)}). </> : 'Escribí el total de la compra. '}
                  Se cargan solas en {card ? `cada vencimiento de ${card.name}` : 'el mismo día de cada mes'}: {datesText(instDates)}.
                  {!S.cards.length && ' Cargá tus tarjetas en Más → Tarjetas para que caigan en cada vencimiento.'}
                </p>
              </>
            )}
          </div>
        )}

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
            <p class="hint">Categoría</p>
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
      <div class="sheet-foot tx-foot">
        {editing && <button class="btn ghost danger" onClick={del}><Icon name="trash" size={18} /> Eliminar</button>}
        <button class={`btn primary${ready ? '' : ' dim'}`} onClick={() => save()}>
          {editing ? 'Guardar cambios' : useInst ? `Cargar ${nInst} cuotas${valid ? ` · ${money(ars)}` : ''}` : `Cargar ${TYPE_LABEL[type].toLowerCase()}${valid ? ` · ${money(ars)}` : ''}`}
        </button>
      </div>
    </Sheet>
  )
}

const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
function datesText(ds) {
  const t = ds.map(ddmm)
  if (t.length <= 4) return t.slice(0, -1).join(', ') + (t.length > 1 ? ' y ' : '') + t.at(-1)
  return `${t[0]}, ${t[1]} … ${t.at(-1)}`
}

function fmtInput(cents) {
  if (cents == null) return ''
  const v = cents / 100
  return v.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}
