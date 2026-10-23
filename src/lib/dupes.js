// Detección de posibles duplicados. Tres casos:
//  'same'  → mismo monto, mismo tipo, a pocos días (y misma categoría o descripción parecida)
//  'sum'   → un movimiento igual a la suma de 2–4 de la misma categoría el mismo día (± 2)
//  'cuota' → una cuota ("cuota 1 de 3") cuando la compra completa (cuotas × monto) ya está cargada
// Cada grupo tiene una clave estable para poder marcarlo como "no es duplicado".

const DAY = 86400000
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const words = (t) => new Set(`${t.note || t.rawDesc || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w)))
const STOP = new Set(['compra', 'tarjeta', 'debito', 'credito', 'transferencia', 'transf', 'realizada', 'inmediata', 'recibida', 'enviada', 'titular', 'pago', 'cuota', 'para', 'ingreso', 'dinero', 'mercado', 'merpago', 'mercpago'])
const shareWord = (a, b) => { const wa = words(a); for (const w of words(b)) if (wa.has(w)) return true; return false }
export const groupKey = (ids) => [...ids].sort().join('|')

export function cuotaInfo(t) {
  const s = `${t.note || ''} ${t.rawDesc || ''}`.toLowerCase()
  // "cuota 1 de 3", "cuota 2/6", "C1/6", "cuota zapatillas (son 3)"
  const m = s.match(/\bc(?:uota)?\s*(\d+)\s*(?:\/|de)\s*(\d+)/) || (/cuota/.test(s) && s.match(/\(son (\d+)\)()/))
  if (!m) return null
  const n = Number(m[2] || m[1])
  return n >= 2 && n <= 24 ? { n } : null
}

export function findDupes(txs, ignored = []) {
  const ign = new Set(ignored)
  const list = txs.filter((t) => (t.type === 'expense' || t.type === 'income') && t.amount >= 100000) // desde $1.000
    .map((t) => ({ t, d: day(t.date) })).sort((a, b) => a.d - b.d)
  const groups = []
  const seen = new Set()
  const add = (kind, items, extra = {}) => {
    const key = groupKey(items.map((x) => x.id))
    if (seen.has(key) || ign.has(key)) return
    seen.add(key); groups.push({ kind, key, txs: items, ...extra })
  }

  // 1) uno igual a la suma de varios (mismo tipo y categoría, ± 1 día, diferencia ≤ $2)
  for (const x of list) {
    if (x.t.amount < 2000000) continue
    const near = list.filter((y) => y !== x && Math.abs(y.d - x.d) <= 1 && y.t.type === x.t.type && y.t.categoryId === x.t.categoryId && y.t.amount < x.t.amount).slice(0, 12)
    let hit = null
    const rec = (start, picked, sum) => {
      if (hit) return
      if (picked.length >= 2 && Math.abs(sum - x.t.amount) <= 200) { hit = picked; return }
      if (picked.length === 4) return
      for (let k = start; k < near.length; k++) if (sum + near[k].t.amount <= x.t.amount + 200) rec(k + 1, [...picked, near[k].t], sum + near[k].t.amount)
    }
    rec(0, [], 0)
    if (hit) add('sum', [x.t, ...hit], { total: x.t.id })
  }
  const inSum = new Set(groups.flatMap((g) => g.txs.map((t) => t.id)))

  // 2) mismo monto (± $5) a pocos días. Montos redondos o chicos se repiten por casualidad:
  //    ahí además pedimos una palabra en común en la descripción.
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    for (let j = i + 1; j < list.length && list[j].d - a.d <= 15; j++) {
      const b = list[j]
      if (a.t.type !== b.t.type || Math.abs(a.t.amount - b.t.amount) > 500) continue
      if (a.t.installment && a.t.installment.group === b.t.installment?.group) continue
      if (inSum.has(a.t.id) && inSum.has(b.t.id)) continue
      const sameCat = !!a.t.categoryId && a.t.categoryId === b.t.categoryId
      const word = shareWord(a.t, b.t)
      const casual = a.t.amount % 50000 === 0 || a.t.amount < 1000000
      const ok = b.d - a.d <= 5 ? (casual ? word : sameCat || word || !a.t.categoryId || !b.t.categoryId) : sameCat && !casual
      if (ok) add('same', [a.t, b.t])
    }
  }

  // 3) cuota cargada aparte de la compra completa (hasta 75 días antes o 10 después)
  for (const c of list) {
    const info = !c.t.installment && cuotaInfo(c.t) // las cuotas generadas por la app ya saben de qué compra son
    if (!info) continue
    for (const x of list) {
      if (x === c || x.t.type !== c.t.type || cuotaInfo(x.t) || x.d - c.d > 10 || c.d - x.d > 75) continue
      const n = info.n
      if (Math.abs(x.t.amount - n * c.t.amount) <= Math.max(300, n * 100)) { add('cuota', [c.t, x.t], { n, cuota: c.t.id }); break }
    }
  }

  return groups.sort((a, b) => (a.txs[0].date < b.txs[0].date ? 1 : -1))
}

export function explain(g, money) {
  if (g.kind === 'same') return 'Mismo monto con pocos días de diferencia'
  if (g.kind === 'sum') return `${money(g.txs[0].amount)} es la suma exacta de los otros ${g.txs.length - 1}`
  return `La compra completa ya está cargada: ${g.n} cuotas de ${money(g.txs[0].amount)}`
}
