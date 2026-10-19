// Exportar a Excel: una hoja por tipo (Gastos, Ingresos, Transferencias), como la app anterior.
// La hoja de gastos o de ingresos se puede volver a importar (columnas Fecha, Tipo, Monto, Categoría…).
import { S, catById, accById, tagById } from './store.js'

const B = { fontWeight: 'bold' }
const asDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const num = (cents, fmt = '#,##0.00') => (cents == null ? null : { value: cents / 100, type: Number, format: fmt })
const dateCell = (iso) => ({ value: asDate(iso), type: Date, format: 'dd/mm/yyyy' })

function movesSheet(txs, label) {
  const head = ['Fecha', 'Tipo', 'Categoría', 'Monto', 'Cuenta', 'Etiquetas', 'Descripción', 'Monto USD', 'Cotización', 'Detalle del extracto']
  const rows = txs.map((t) => [
    dateCell(t.date),
    label,
    catById(t.categoryId)?.name || 'Sin categoría',
    num(t.amount),
    accById(t.accountId)?.name || '',
    (t.tagIds || []).map((id) => tagById(id)?.name).filter(Boolean).join(', '),
    t.note || '',
    t.currency === 'USD' ? num(t.origAmount) : null,
    t.currency === 'USD' && t.rate ? { value: t.rate, type: Number, format: '#,##0.00' } : null,
    t.rawDesc && t.rawDesc !== t.note ? t.rawDesc : '',
  ])
  const total = txs.reduce((s, t) => s + t.amount, 0)
  return {
    data: [head.map((h) => ({ value: h, ...B })), ...rows, [], [{ value: 'Total', ...B }, null, null, { ...num(total), ...B }]],
    columns: [{ width: 12 }, { width: 9 }, { width: 24 }, { width: 15 }, { width: 14 }, { width: 18 }, { width: 36 }, { width: 11 }, { width: 11 }, { width: 44 }],
    stickyRowsCount: 1,
  }
}

function transfersSheet(txs) {
  const head = ['Fecha', 'Desde', 'Hacia', 'Monto', 'Monto USD', 'Cotización', 'Descripción']
  return {
    data: [head.map((h) => ({ value: h, ...B })), ...txs.map((t) => [
      dateCell(t.date), accById(t.accountId)?.name || '', accById(t.toAccountId)?.name || '', num(t.amount),
      t.currency === 'USD' ? num(t.origAmount) : null, t.currency === 'USD' && t.rate ? { value: t.rate, type: Number, format: '#,##0.00' } : null, t.note || '',
    ])],
    columns: [{ width: 12 }, { width: 14 }, { width: 14 }, { width: 15 }, { width: 11 }, { width: 11 }, { width: 36 }],
    stickyRowsCount: 1,
  }
}

// what: 'expense' | 'income' | 'all'; from/to: ISO o null (todo)
export function selectTxs(what, from, to) {
  return S.txs.filter((t) => (!from || t.date >= from) && (!to || t.date <= to) && (what === 'all' || t.type === what))
}

export async function buildXlsx(what, from, to) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const txs = selectTxs(what, from, to) // ya vienen de la más nueva a la más vieja
  const sheets = []
  const exp = txs.filter((t) => t.type === 'expense')
  const inc = txs.filter((t) => t.type === 'income')
  const tr = txs.filter((t) => t.type === 'transfer')
  if (what !== 'income') sheets.push({ sheet: 'Gastos', ...movesSheet(exp, 'Gasto') })
  if (what !== 'expense') sheets.push({ sheet: 'Ingresos', ...movesSheet(inc, 'Ingreso') })
  if (what === 'all' && tr.length) sheets.push({ sheet: 'Transferencias', ...transfersSheet(tr) })
  return writeExcelFile(sheets, { fontFamily: 'Calibri', fontSize: 11 }).toBlob()
}
