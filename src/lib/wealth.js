// Patrimonio: "fotos" de tus saldos reales cada tanto (cuentas, inversiones, deudas de tarjeta).
// Cuentas del patrimonio (en ajustes): settings.wealth = { accounts: [{ id, name, currency: 'ARS'|'USD', kind: 'asset'|'debt', liquid }], goalMonths }
// Una foto (tabla snapshots): { id, date: 'YYYY-MM-DD', rate (dólar usado para pasar pesos a US$), values: { accountId: centavos en su moneda } }
// Para un saldo en dos monedas (ej. resumen de tarjeta $ + US$) se cargan dos cuentas.
import { S, today } from './store.js'
import { spendEntries, incomeEntries } from './metrics.js'

export const wAccounts = () => S.settings.wealth?.accounts || []
export const goalMonths = () => S.settings.wealth?.goalMonths || 6

// Valor en centavos de US$ de un saldo
export const inUsd = (acc, cents, rate) => (acc.currency === 'USD' ? cents : rate > 0 ? cents / rate : 0)

export function summary(snap) {
  const accs = wAccounts()
  let assets = 0, debts = 0, liquid = 0
  const rows = []
  for (const a of accs) {
    const v = snap.values?.[a.id]
    if (v == null) continue
    const u = inUsd(a, v, snap.rate)
    if (a.kind === 'debt') debts += u; else { assets += u; if (a.liquid) liquid += u }
    rows.push({ a, v, u })
  }
  return { assets, debts, net: assets - debts, liquid, rows }
}

// Gasto real promedio de los últimos 3 meses completos, en centavos de US$ (para el fondo de emergencia)
export function monthlySpendUsd(rate) {
  const t0 = today(), d = new Date(t0 + 'T12:00:00')
  const keys = [1, 2, 3].map((i) => { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}` })
  const e = spendEntries().filter((x) => keys.includes(x.date.slice(0, 7)))
  if (!e.length) return 0
  // lo cargado en US$ va exacto; los pesos, al dólar de la foto
  const tot = e.reduce((s, x) => s + (Math.sign(x.amount) || 1) * (x.t.currency === 'USD' && x.t.origAmount ? x.t.origAmount : rate ? Math.abs(x.amount) / rate : 0), 0)
  return tot / 3
}

// Lo que la app registró como ahorro entre dos fotos (ingresos − gasto real), en centavos de US$
export function recordedSavingsUsd(a, b) {
  const rate = (a.rate + b.rate) / 2
  const conv = (t) => (t.currency === 'USD' && t.origAmount ? t.origAmount : t.amount / rate)
  const inc = incomeEntries(S.txs, b.date).filter((t) => t.date > a.date).reduce((s, t) => s + conv(t), 0)
  const exp = spendEntries(S.txs, b.date).filter((e) => e.date > a.date).reduce((s, e) => s + Math.sign(e.amount) * conv(e.t), 0)
  return inc - exp
}

// Archivo de patrimonio (lo armamos por fuera a partir de tus resúmenes): agrega cuentas que falten y fotos
export function parseWealthFile(data) {
  if (data?.app !== 'gastos-patrimonio' || !Array.isArray(data.accounts)) throw new Error('No es un archivo de patrimonio')
  return data
}
