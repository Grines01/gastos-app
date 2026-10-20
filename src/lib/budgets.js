// Presupuestos mensuales por categoría, con arrastre del saldo de un mes al siguiente.
//
// Un presupuesto: { id, categoryId, mode: 'fixed' | 'percent', value, rollover, start: 'YYYY-MM' }
//   mode 'fixed'   → value en centavos por mes
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

export function baseFor(b, income) {
  return b.mode === 'percent' ? Math.round((income * (Number(b.value) || 0)) / 100) : Math.round(Number(b.value) || 0)
}

// Estado de un presupuesto en el mes `k`. null si el presupuesto empieza después.
export function budgetStatus(b, k, totals) {
  if (!b.start || k < b.start) return null
  let carry = 0
  for (let m = b.start; m < k; m = nextMonth(m)) {
    const avail = baseFor(b, totals.income.get(m) || 0) + carry - (totals.spent.get(`${b.categoryId}|${m}`) || 0)
    carry = b.rollover ? avail : 0
  }
  const income = totals.income.get(k) || 0
  const base = baseFor(b, income)
  const total = base + carry
  const spent = totals.spent.get(`${b.categoryId}|${k}`) || 0
  const available = total - spent
  return { base, carry, total, spent, available, income, pct: total > 0 ? spent / total : spent > 0 ? Infinity : 0 }
}
