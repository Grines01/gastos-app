// Importación: archivo -> filas -> movimientos propuestos -> revisión -> guardado.
import { parseAmount, parseDate, norm, daysBetween, uid } from './format.js'
import { S, bulkAddTxs, put, catById } from './store.js'
import { colorFor } from './defaults.js'

// ---------- lectura ----------
export async function readRows(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    return await readSheet(file)
  }
  if (name.endsWith('.xls')) throw new Error('Los .xls viejos no se pueden leer. Abrilo y guardalo como .xlsx o .csv.')
  const buf = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf)
  return parseCSV(text.replace(/^﻿/, ''))
}

export function parseCSV(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || ''
  const counts = { ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length }
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => String(c).trim()))
}

// ---------- detección de formato ----------
const H = (cells) => cells.map((c) => norm(c))

export function detect(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const h = H(rows[i] || [])
    const has = (x) => h.indexOf(x)
    if (has('fecha') >= 0 && has('descripcion') >= 0 && has('referencia') >= 0 && (has('caja de ahorro') >= 0 || has('cuenta corriente') >= 0))
      return { format: 'santander', header: i, col: colMap(h) }
    if (has('fecha y hora') >= 0 && has('categoria') >= 0 && h.some((x) => x.startsWith('cantidad en la divisa predeterminada'))) {
      const title = norm((rows[0] || []).join(' '))
      return { format: 'gestor', header: i, col: colMap(h), kind: title.includes('ingreso') ? 'income' : 'expense' }
    }
    if (has('titulo_descripcion') >= 0 && has('tipo_operacion') >= 0 && has('monto') >= 0)
      return { format: 'mpmovs', header: i, col: colMap(h) }
    if (has('source_id') >= 0 && has('transaction_amount') >= 0)
      return { format: 'mercadopago', header: i, col: colMap(h) }
    if (has('fecha') >= 0 && (has('monto') >= 0 || has('importe') >= 0))
      return { format: 'simple', header: i, col: colMap(h) }
  }
  throw new Error('No reconozco el formato. Usá un extracto de Santander, el reporte de Mercado Pago o un CSV con columnas fecha, monto y descripcion.')
}
function colMap(h) { const m = {}; h.forEach((x, i) => { if (x && m[x] === undefined) m[x] = i }); return m }
const get = (r, col, ...names) => { for (const n of names) if (col[n] !== undefined && r[col[n]] !== null && r[col[n]] !== undefined && String(r[col[n]]).trim() !== '') return r[col[n]]; return null }

// ---------- normalización de descripciones bancarias ----------
const tc = (s) => s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1))
export function cleanBankDesc(raw) {
  const d = String(raw || '').replace(/\s+/g, ' ').trim()
  let m = d.match(/compra con tarjeta de debito (.+?) - tarj nro\.? ?\d*/i)
  if (m) return m[1].replace(/^(merpago|mercpago)\*/i, 'MP ').trim()
  m = d.match(/^(?:transferencia [\w ]*?|transf [\w ]*?) (A|De) (.+?)\s+\//i)
  if (m) return `${m[1] === 'A' || m[1] === 'a' ? 'A' : 'De'} ${tc(m[2].toLowerCase())}`
  if (/pago tarjeta de credito visa/i.test(d)) return 'Pago tarjeta Visa'
  if (/^debito automatico arca/i.test(d)) return 'Débito automático ARCA'
  if (/^comision por servicio de cuenta/i.test(d)) return 'Comisión mantenimiento de cuenta'
  if (/^iva 21%/i.test(d)) return 'IVA sobre comisiones'
  if (/^impuesto ley 25\.413/i.test(d)) return 'Impuesto débitos y créditos'
  if (/^transf online banking propia/i.test(d)) return 'Transferencia entre cuentas propias'
  return d.replace(/\s+-?\s*$/, '')
}
// Clave estable de comercio/destinatario para reglas
export function merchantKey(display) {
  return norm(display).replace(/\b\d{5,}\b/g, '').replace(/[^\p{L}\p{N}* ]/gu, ' ').replace(/\s+/g, ' ').trim()
}

// ---------- filas -> items ----------
export function toItems(rows, det) {
  const out = []
  const body = rows.slice(det.header + 1)
  for (const r of body) {
    const c = det.col
    if (det.format === 'santander') {
      const date = parseDate(get(r, c, 'fecha')); if (!date) continue
      const amt = parseAmount(get(r, c, 'caja de ahorro', 'cuenta corriente'))
      if (!Number.isFinite(amt) || amt === 0) continue
      const raw = String(get(r, c, 'descripcion') || '')
      const desc = cleanBankDesc(raw)
      out.push({ date, amount: amt, desc, raw, ref: String(get(r, c, 'referencia') || '') })
    } else if (det.format === 'mpmovs') {
      // "Movimientos" de la app de Mercado Pago copiados a una planilla
      const estado = norm(get(r, c, 'estado') || 'aprobado')
      if (!estado.startsWith('aprob')) continue
      const date = parseDate(get(r, c, 'fecha')); if (!date) continue
      const amt = parseAmount(get(r, c, 'monto'))
      if (!Number.isFinite(amt) || amt === 0) continue
      const desc = String(get(r, c, 'titulo_descripcion') || '').trim()
      const op = norm(get(r, c, 'tipo_operacion') || '')
      const it = { date, amount: amt, desc, raw: desc, ref: `${date} ${get(r, c, 'hora') || ''} ${desc}`, viaBank: norm(get(r, c, 'medio_pago') || '').includes('con transferencia') }
      if (op.startsWith('ingreso de dinero')) { it.skipHint = true; it.hint = 'Ingreso desde tu banco: ya cuenta como transferencia propia' }
      if (op.startsWith('pago de resumen')) { it.skipHint = true; it.hint = 'Pago de la tarjeta: las compras ya figuran una por una' }
      if (String(get(r, c, 'moneda') || '').toUpperCase() === 'USD') { it.currency = 'USD'; it.origAmount = Math.abs(amt); it.needsRate = true }
      out.push(it)
    } else if (det.format === 'mercadopago') {
      const date = parseDate(get(r, c, 'transaction_date')); if (!date) continue
      const amt = parseAmount(get(r, c, 'real_amount', 'transaction_amount'))
      if (!Number.isFinite(amt) || amt === 0) continue
      const method = norm(get(r, c, 'payment_method_type') || '')
      const unit = String(get(r, c, 'sub_unit') || get(r, c, 'business_unit') || '').trim()
      let desc
      if (amt > 0 && method === 'bank_transfer') desc = 'Ingreso por transferencia bancaria'
      else if (amt > 0 && !method) desc = 'Rendimientos Mercado Pago'
      else if (amt > 0) desc = `Cobro Mercado Pago${unit ? ' ' + unit : ''}`
      else desc = unit ? (/mercado libre/i.test(unit) ? 'Compra Mercado Libre' : `Pago MP ${unit}`) : 'Pago Mercado Pago'
      const interest = amt > 0 && !method
      out.push({ date, amount: amt, desc, raw: desc, ref: String(get(r, c, 'source_id') || ''), skipHint: amt > 0 && method === 'bank_transfer', generic: true,
        ...(interest ? { category: 'Rendimientos', trusted: true } : {}) })
    } else if (det.format === 'gestor') {
      const date = parseDate(get(r, c, 'fecha y hora')); if (!date) continue
      const amt = parseAmount(get(r, c, 'cantidad en la divisa predeterminada'))
      if (!Number.isFinite(amt) || amt === 0) continue
      const txCur = get(r, c, 'divisa de la transaccion')
      const txAmt = parseAmount(get(r, c, 'cantidad de la transaccion en la divisa de la transaccion'))
      const it = {
        date, amount: det.kind === 'income' ? Math.abs(amt) : -Math.abs(amt),
        desc: String(get(r, c, 'comentario') || ''), category: String(get(r, c, 'categoria') || ''),
        tags: splitTags(get(r, c, 'etiquetas')), account: String(get(r, c, 'cuenta') || ''), trusted: true,
      }
      const accCur = get(r, c, 'divisa de la cuenta')
      const accAmt = parseAmount(get(r, c, 'cantidad en la divisa de la cuenta'))
      if (txCur === 'USD' && Number.isFinite(txAmt) && txAmt) { it.currency = 'USD'; it.origAmount = Math.abs(txAmt); it.rate = Math.round((Math.abs(amt) / Math.abs(txAmt)) * 100) / 100 }
      else if (accCur === 'USD' && Number.isFinite(accAmt) && accAmt) { it.currency = 'USD'; it.origAmount = Math.abs(accAmt); it.rate = Math.round((Math.abs(amt) / Math.abs(accAmt)) * 100) / 100 }
      out.push(it)
    } else {
      const date = parseDate(get(r, c, 'fecha')); if (!date) continue
      let amt = parseAmount(get(r, c, 'monto', 'importe'))
      if (!Number.isFinite(amt) || amt === 0) continue
      const tipo = norm(get(r, c, 'tipo') || '')
      if (tipo.startsWith('gasto')) amt = -Math.abs(amt)
      if (tipo.startsWith('ingreso')) amt = Math.abs(amt)
      const cur = String(get(r, c, 'moneda') || '').toUpperCase()
      const it = {
        date, amount: amt, desc: String(get(r, c, 'descripcion', 'detalle', 'concepto', 'nota') || ''), ref: String(get(r, c, 'referencia', 'id') || ''),
        category: get(r, c, 'categoria') && norm(get(r, c, 'categoria')) !== 'sin categoria' ? String(get(r, c, 'categoria')) : '', tags: splitTags(get(r, c, 'etiquetas')),
        account: String(get(r, c, 'cuenta') || ''), note: String(get(r, c, 'nota') || ''), skip: tipo.startsWith('ignor'),
        transfer: tipo.startsWith('transf'), toAccount: String(get(r, c, 'cuenta_destino', 'cuenta destino') || ''),
      }
      if (cur === 'USD') {
        const rate = parseAmount(get(r, c, 'cotizacion')) / 100
        const ars = parseAmount(get(r, c, 'monto_ars'))
        if (rate > 0) { it.currency = 'USD'; it.origAmount = Math.abs(amt); it.rate = rate; it.amount = Math.sign(amt) * (Number.isFinite(ars) && ars ? Math.abs(ars) : Math.round(Math.abs(amt) * rate)) }
      }
      it.trusted = !!it.category
      out.push(it)
    }
  }
  return out
}
const splitTags = (v) => (v ? String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [])

// ---------- reglas ----------
export function findRule(key) {
  let best = null
  for (const r of S.rules) if (r.pattern && key.includes(r.pattern) && (!best || r.pattern.length > best.pattern.length)) best = r
  return best
}

// ---------- propuesta con detección de duplicados ----------
export function propose(items, { format, accountId }) {
  const existingIds = new Set(S.txs.map((t) => t.externalId).filter(Boolean))
  const occ = {}
  const claimed = new Set()
  const rows = items.map((it, i) => {
    // descripciones genéricas (Mercado Pago) no sirven para reglas: cada pago QR dice lo mismo
    const key = it.generic ? '' : merchantKey(it.desc)
    const base = `${format}|${it.date}|${it.amount}|${it.ref || key}`
    occ[base] = (occ[base] || 0) + 1
    const externalId = `${base}#${occ[base]}`
    const kind = it.amount < 0 ? 'expense' : 'income'
    const row = {
      i, it, key, externalId, type: it.skip ? 'skip' : kind, amount: Math.abs(it.amount), categoryId: null, newCategory: null,
      tagIds: [], note: it.note || it.desc, accountId: accountForName(it.account) || accountId, toAccountId: null,
      include: true, status: 'new', match: null, rule: null, touched: false,
    }
    if (it.category) {
      const c = S.categories.find((x) => x.kind === kind && norm(x.name) === norm(it.category))
      if (c) row.categoryId = c.id; else row.newCategory = it.category
    }
    row.tagIds = (it.tags || []).map((n) => S.tags.find((t) => norm(t.name) === norm(n))?.id || `new:${n}`)
    if (it.transfer) { row.type = 'transfer'; row.toAccountId = accountForName(it.toAccount); it.trusted = true }
    if (!it.trusted) {
      const rule = findRule(key)
      if (rule) {
        row.rule = rule
        if (rule.action === 'skip') { row.type = 'skip'; row.include = false; row.status = 'skip' }
        else if (rule.action === 'transfer') { row.type = 'transfer'; row.toAccountId = rule.toAccountId }
        else if (rule.categoryId && catById(rule.categoryId)?.kind === kind) row.categoryId = rule.categoryId
        if (rule.tagIds?.length) row.tagIds = [...new Set([...row.tagIds, ...rule.tagIds])]
        if (rule.note) row.note = rule.note
      }
    }
    if (it.skipHint && !row.rule) { row.type = 'skip'; row.include = false; row.status = 'skip'; row.hint = it.hint || 'Probable transferencia desde tu banco' }
    if (it.needsRate) { row.type = 'skip'; row.include = false; row.status = 'skip'; row.hint = 'En dólares y sin cotización: cargalo a mano' }
    if (existingIds.has(externalId)) { row.status = 'imported'; row.include = false }
    return row
  })
  // posibles duplicados contra lo ya cargado (cualquier cuenta)
  const cands = []
  rows.forEach((row, ri) => {
    if (row.status !== 'new' || row.type === 'transfer') return
    for (const t of S.txs) {
      if (t.type !== (row.it.amount < 0 ? 'expense' : 'income')) continue
      const dd = Math.abs(daysBetween(t.date, row.it.date)); if (dd > 4) continue
      const da = Math.abs(t.amount - row.amount)
      // dos extractos distintos (ej: Santander y Mercado Pago) solo se pisan si el monto es idéntico al centavo
      // y hablan de lo mismo (comparten una palabra) o el pago de MP salió del banco ("Con transferencia")
      if (BANK_SOURCES.includes(t.source)) {
        if (da !== 0 || dd > 2) continue
        if (t.source !== format && !row.it.viaBank && !sharesWord(t.rawDesc || t.note, row.it.desc)) continue
      }
      const exact = da <= 100
      const approx = dd <= 1 && da / row.amount <= 0.02
      if (exact || approx) cands.push({ ri, t, score: (exact ? 0 : 10) + dd + da / row.amount })
    }
  })
  cands.sort((a, b) => a.score - b.score)
  const done = new Set()
  for (const c of cands) {
    if (done.has(c.ri) || claimed.has(c.t.id)) continue
    done.add(c.ri); claimed.add(c.t.id)
    const row = rows[c.ri]
    row.status = 'dup'; row.match = c.t; row.include = false
    if (!row.categoryId && c.t.categoryId) row.categoryId = c.t.categoryId
  }
  // un pago del banco que cargaste como dos movimientos (ej: expensas ordinarias + extraordinarias)
  for (const row of rows) {
    if (row.status !== 'new' || row.type === 'transfer' || row.type === 'skip' || row.amount < 5000000) continue // solo montos grandes: en chicos sobran coincidencias
    const kind = row.it.amount < 0 ? 'expense' : 'income'
    const pool = S.txs.filter((t) => t.type === kind && !claimed.has(t.id) && t.amount < row.amount && Math.abs(daysBetween(t.date, row.it.date)) <= 2)
    let pair = null
    for (let a = 0; a < pool.length && !pair; a++)
      for (let b = a + 1; b < pool.length; b++)
        if (Math.abs(pool[a].amount + pool[b].amount - row.amount) <= 100) { pair = [pool[a], pool[b]]; break }
    if (pair) {
      pair.forEach((t) => claimed.add(t.id))
      row.status = 'dup'; row.include = false; row.sumMatch = true; row.match = { ...pair[0], amount: row.amount, note: `${pair[0].note || ''} + ${pair[1].note || ''}`, date: pair[0].date }
      if (!row.categoryId) row.categoryId = pair[0].categoryId
    }
  }
  // lo que ya cargaste a mano enseña: si un comercio coincidió con una carga tuya, sus otras compras van a esa categoría
  const learned = learnFromMatches(rows)
  for (const r of rows) {
    if (r.status !== 'new' || r.categoryId || r.rule || (r.type !== 'expense' && r.type !== 'income')) continue
    const cid = learned[r.key]
    if (cid && catById(cid)?.kind === r.type) { r.categoryId = cid; r.fromHistory = true }
  }
  return rows
}
const BANK_SOURCES = ['santander', 'mercadopago', 'mpmovs']
const words = (s) => new Set(merchantKey(cleanBankDesc(s || '')).split(' ').filter((w) => w.length >= 4))
function sharesWord(a, b) { const A = words(a); for (const w of words(b)) if (A.has(w)) return true; return false }
// marketplaces: venden de todo, no sirven para aprender una categoría
const MARKETPLACES = /mercado libre|temu|shein|amazon|aliexpress|tienda nube/
const isMerchant = (key) => key && key.length >= 3 && !/^(a|de) /.test(key) && !MARKETPLACES.test(key)
function learnFromMatches(rows) {
  const out = {}
  for (const r of rows) {
    if (r.status !== 'dup' || r.sumMatch || !r.match?.categoryId || !isMerchant(r.key)) continue
    if (out[r.key] === undefined) out[r.key] = r.match.categoryId
    else if (out[r.key] !== r.match.categoryId) out[r.key] = null // ambiguo: no aprende
  }
  return out
}
function accountForName(name) {
  if (!name) return null
  return S.accounts.find((a) => norm(a.name) === norm(name))?.id || null
}

// ---------- guardado ----------
export async function commit(rows, { fileName, format }) {
  const batchId = uid()
  const now = Date.now()
  // categorías y etiquetas nuevas
  const newCats = {}
  for (const r of rows) {
    if (!r.include || r.categoryId || !r.newCategory || r.type === 'skip' || r.type === 'transfer') continue
    const k = `${r.type}|${norm(r.newCategory)}`
    if (!newCats[k]) {
      const n = S.categories.filter((c) => c.kind === r.type).length
      newCats[k] = await put('categories', { kind: r.type, name: r.newCategory, emoji: '🏷️', color: colorFor(n), order: n })
    }
    r.categoryId = newCats[k].id
  }
  const newTags = {}
  for (const r of rows) {
    if (!r.include) continue
    r.tagIds = await Promise.all(r.tagIds.map(async (id) => {
      if (!String(id).startsWith('new:')) return id
      const n = id.slice(4)
      if (!newTags[n]) newTags[n] = await put('tags', { name: n })
      return newTags[n].id
    }))
  }
  const txs = rows.filter((r) => r.include && r.type !== 'skip').map((r, k) => ({
    id: uid(), type: r.type, date: r.it.date, amount: r.amount,
    // transferencia entrante: viene de la otra cuenta hacia la del extracto
    accountId: r.type === 'transfer' && r.it.amount > 0 && !r.it.transfer ? r.toAccountId : r.accountId,
    toAccountId: r.type === 'transfer' ? (r.it.amount > 0 && !r.it.transfer ? r.accountId : r.toAccountId) : null,
    categoryId: r.type === 'transfer' ? null : r.categoryId, tagIds: r.tagIds, note: r.note || '',
    rawDesc: r.it.raw || r.it.desc, externalId: r.externalId, batchId, source: format,
    currency: r.it.currency || 'ARS', origAmount: r.it.origAmount || null, rate: r.it.rate || null,
    createdAt: now + k, updatedAt: now,
  }))
  const batch = { id: batchId, createdAt: now, fileName, format, count: txs.length }
  await bulkAddTxs(txs, txs.length ? batch : null)
  // aprender reglas de lo que el usuario corrigió a mano (solo extractos bancarios)
  let learned = 0
  if (format === 'santander' || format === 'simple' || format === 'mercadopago' || format === 'mpmovs') {
    for (const r of rows) {
      if (!r.touched || !r.key || r.key.length < 3) continue
      const existing = S.rules.find((x) => x.pattern === r.key)
      let rule = null
      if (r.type === 'skip') rule = { action: 'skip' }
      else if (r.type === 'transfer' && r.toAccountId) rule = { action: 'transfer', toAccountId: r.toAccountId }
      else if (r.categoryId && r.include) rule = { action: 'category', categoryId: r.categoryId }
      if (!rule) continue
      await put('rules', { ...(existing || {}), pattern: r.key, ...rule, updatedAt: now })
      learned++
    }
    for (const [key, categoryId] of Object.entries(learnFromMatches(rows))) {
      if (!categoryId || S.rules.some((x) => x.pattern === key)) continue
      await put('rules', { pattern: key, action: 'category', categoryId, updatedAt: now, auto: true })
      learned++
    }
  }
  return { imported: txs.length, learned, pending: txs.filter((t) => (t.type === 'expense' || t.type === 'income') && !t.categoryId).length }
}

// ---------- exportar CSV (mismo formato que acepta la importación) ----------
export function toCSV(txs) {
  const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const head = ['fecha', 'tipo', 'monto', 'moneda', 'cotizacion', 'monto_ars', 'cuenta', 'cuenta_destino', 'categoria', 'etiquetas', 'descripcion']
  const lines = [head.join(';')]
  for (const t of txs) {
    const acc = S.accounts.find((a) => a.id === t.accountId)?.name || ''
    const to = S.accounts.find((a) => a.id === t.toAccountId)?.name || ''
    const cat = S.categories.find((c) => c.id === t.categoryId)?.name || ''
    const tags = (t.tagIds || []).map((id) => S.tags.find((x) => x.id === id)?.name).filter(Boolean).join(',')
    const usd = t.currency === 'USD'
    const val = usd ? t.origAmount / 100 : t.amount / 100
    lines.push([t.date, { expense: 'gasto', income: 'ingreso', transfer: 'transferencia' }[t.type], String(val).replace('.', ','), usd ? 'USD' : 'ARS', usd ? String(t.rate).replace('.', ',') : '', usd ? String(t.amount / 100).replace('.', ',') : '', acc, to, cat, tags, t.note].map(esc).join(';'))
  }
  return lines.join('\n')
}
