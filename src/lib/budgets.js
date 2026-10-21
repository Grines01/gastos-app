// Presupuestos mensuales por categoría, con arrastre del saldo de un mes al siguiente.
//
// Un presupuesto: { id, categoryId, mode: 'fixed' | 'percent', value, currency?, rate?, rollover, start: 'YYYY-MM' }
//   mode 'fixed'   → value en centavos por mes (de pesos, o de dólares si currency === 'USD')
//                    en dólares se pasa a pesos con el promedio del mes del dólar elegido (fx);
//                    si no hay serie (sin internet), con la cotización guardada al crearlo (rate)
//   mode 'percent' → value = % de los ingresos de ESE mes (ej. 15)
//
// No se guardan "cierres de mes": el arrastre se calcula en el momento desde el mes de inicio.
// Así, si corregís un gasto de un mes pasado, el saldo que se arrastra se actualiza solo.

export const monthKey = (iso) => iso.slice(0, 7)
export function nextMonth(k) {
  const [y, m] = k.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

// Sumas por mes, una sola pasada por los movimientos
export function monthTotals(txs) {
  const income = new Map() // 'YYYY-MM' → centavos
  const spent = new Map() // 'catId|YYYY-MM' → centavos
  for (const t of txs) {
    const k = monthKey(t.date)
    if (t.type === 'income') income.set(k, (income.get(k) || 0) + t.amount)
    else if (t.type === 'expense' && t.categoryId) {
      const kk = `${t.categoryId}|${k}`
      spent.set(kk, (spent.get(kk) || 0) + t.amount)
    }
  }
  return { income, spent }
}

export function baseFor(b, income, rate) {
  if (b.mode === 'percent') return Math.round((income * (Number(b.value) || 0)) / 100)
  if (b.currency === 'USD') return rate > 0 ? Math.round((Number(b.value) || 0) * rate) : 0
  return Math.round(Number(b.value) || 0)
}

// Cotización para el mes k: promedio de ese mes; si todavía no hay, la última anterior; si no, la guardada
export function rateFor(b, k, fx) {
  if (b.currency !== 'USD') return null
  if (fx) {
    if (fx[k]) return fx[k]
    const prev = Object.keys(fx).filter((m) => m <= k).sort().at(-1)
    if (prev) return fx[prev]
  }
  return b.rate || null
}

// Estado de un presupuesto en el mes `k`. null si el presupuesto empieza después.
export function budgetStatus(b, k, totals, fx) {
  if (!b.start || k < b.start) return null
  let carry = 0
  for (let m = b.start; m < k; m = nextMonth(m)) {
    const avail = baseFor(b, totals.income.get(m) || 0, rateFor(b, m, fx)) + carry - (totals.spent.get(`${b.categoryId}|${m}`) || 0)
    carry = b.rollover ? avail : 0
  }
  const income = totals.income.get(k) || 0
  const rate = rateFor(b, k, fx)
  const base = baseFor(b, income, rate)
  const total = base + carry
  const spent = totals.spent.get(`${b.categoryId}|${k}`) || 0
  const available = total - spent
  return { base, carry, total, spent, available, income, rate, pct: total > 0 ? spent / total : spent > 0 ? Infinity : 0 }
}
