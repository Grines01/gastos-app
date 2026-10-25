// Gasto e ingreso "reales" para los análisis (Inicio, Resumen, presupuestos).
//
// - Reintegros (categoría Cashback o Reintegros, o el pago de un amigo en un gasto compartido)
//   no son ingreso: se restan del gasto.
//     · el de un gasto compartido va a la categoría, las etiquetas y el MES de ese gasto
//     · el resto (Cashback suelto, reintegros de viáticos) se resta del total del mes en que entró
// - Lo programado a futuro (cuotas que todavía no vencen) no cuenta como gastado: se ve en "Próximos meses".
import { S, today } from './store.js'

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const refundCatIds = () => new Set(S.categories.filter((c) => c.kind === 'income' && /^(cashback|reintegro)/.test(norm(c.name))).map((c) => c.id))
export const isRefund = (t, rc = refundCatIds()) => t.type === 'income' && (!!t.splitOf || rc.has(t.categoryId))

// Cada gasto suma y cada reintegro resta: { date, categoryId, amount (negativo si es reintegro), tagIds, t, refund?: 'split' | 'other' }
export function spendEntries(txs = S.txs, upto = today()) {
  const rc = refundCatIds()
  const byId = new Map()
  for (const t of txs) if (t.split) byId.set(t.id, t)
  const out = []
  for (const t of txs) {
    if (t.date > upto) continue
    if (t.type === 'expense') out.push({ date: t.date, categoryId: t.categoryId || null, amount: t.amount, tagIds: t.tagIds || [], t })
    else if (isRefund(t, rc)) {
      const e = t.splitOf && byId.get(t.splitOf)
      out.push(e
        ? { date: e.date, categoryId: e.categoryId || null, amount: -t.amount, tagIds: e.tagIds || [], t, refund: 'split' }
        : { date: t.date, categoryId: null, amount: -t.amount, tagIds: [], t, refund: 'other' })
    }
  }
  return out
}

// Ingresos sin reintegros ni programados
export function incomeEntries(txs = S.txs, upto = today()) {
  const rc = refundCatIds()
  return txs.filter((t) => t.type === 'income' && t.date <= upto && !isRefund(t, rc))
}

// Monto atípico: más de 10 veces la mediana de esa categoría en los últimos 6 meses (con al menos 3 gastos)
export function unusualAmount(t, txs = S.txs) {
  if (t.type !== 'expense' || !t.categoryId || t.installment) return null
  const d = new Date(t.date + 'T12:00:00'); d.setMonth(d.getMonth() - 6)
  const since = d.toLocaleDateString('sv')
  const vals = txs.filter((x) => x.id !== t.id && x.type === 'expense' && x.categoryId === t.categoryId && x.date >= since && x.date <= t.date).map((x) => x.amount).sort((a, b) => a - b)
  if (vals.length < 3) return null
  const med = vals[Math.floor(vals.length / 2)]
  return med > 0 && t.amount >= med * 10 && t.amount >= 5000000 ? { times: Math.round(t.amount / med), median: med } : null
}
