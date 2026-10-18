// Montos: siempre enteros en centavos. Fechas: strings 'YYYY-MM-DD' en hora local.

const fmt0 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmt2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function money(cents, { decimals = 'auto', sign = '' } = {}) {
  const v = Math.abs(cents) / 100
  const useDec = decimals === true || (decimals === 'auto' && Math.abs(cents) % 100 !== 0)
  const s = (useDec ? fmt2 : fmt0).format(v)
  return `${sign}$ ${s}`
}

export function compactMoney(cents) {
  const v = Math.abs(cents) / 100
  if (v === 0) return '0'
  if (v >= 1e6) return `$ ${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
  if (v >= 1e3) return `$ ${Math.round(v / 1e3).toLocaleString('es-AR')} k`
  return `$ ${Math.round(v)}`
}

// Interpreta montos escritos a la argentina ("57.000,50") o con punto decimal ("57000.5").
export function parseAmount(input) {
  if (input === null || input === undefined) return NaN
  if (typeof input === 'number') return Math.round(input * 100)
  let s = String(input).trim().replace(/\s|\$/g, '')
  if (!s) return NaN
  let neg = false
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  else if (s.startsWith('+')) s = s.slice(1)
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '')
  } else if (/^\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace('.', '') // "57.000" = cincuenta y siete mil
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN
  const v = Math.round(parseFloat(s) * 100)
  return neg ? -v : v
}

export const pad = (n) => String(n).padStart(2, '0')
export function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export function today() { return toISO(new Date()) }
export function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d) }
export function daysBetween(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000) }

// Acepta Date, 'dd/mm/yyyy', 'yyyy-mm-dd', 'dd-mm-yy', 'yyyy-mm-ddThh:mm'
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) {
    // las fechas de Excel llegan en UTC a medianoche
    const utcMidnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0
    return utcMidnight ? `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}` : toISO(v)
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) { // serial de Excel
    const d = new Date(Math.round((v - 25569) * 86400000))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000
    return `${y}-${pad(m[2])}-${pad(m[1])}`
  }
  return null
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MES3 = MESES.map((m) => m.slice(0, 3))
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export const monthName = (i) => MESES[i]
export const monthShort = (i) => MES3[i]
export function dayLabel(iso) {
  const t = today()
  if (iso === t) return 'Hoy'
  if (iso === addDays(t, -1)) return 'Ayer'
  const d = fromISO(iso)
  const s = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
  return (s[0].toUpperCase() + s.slice(1)) + (d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '')
}
export function shortDate(iso) { const d = fromISO(iso); return `${d.getDate()} ${MES3[d.getMonth()]}` }
export function ddmm(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}` }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}
