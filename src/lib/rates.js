// Cotizaciones del dólar. Hoy: dolarapi.com. Fechas pasadas: argentinadatos.com.
// Si no hay internet, el usuario escribe la cotización a mano.
import { today } from './format.js'

export const RATE_KINDS = [
  { id: 'bolsa', name: 'MEP' },
  { id: 'oficial', name: 'Oficial' },
  { id: 'blue', name: 'Blue' },
  { id: 'cripto', name: 'Cripto' },
]

const cache = new Map()

async function getJSON(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

// side: 'compra' (vendés dólares: ingresos) | 'venta' (comprás dólares: gastos)
export async function fetchRate(kind, date, side) {
  const key = `${kind}|${date}|${side}`
  if (cache.has(key)) return cache.get(key)
  let val = null
  if (date >= today()) {
    const j = await getJSON(`https://dolarapi.com/v1/dolares/${kind}`)
    val = j?.[side] ?? j?.venta
  } else {
    // busca la fecha o, si fue feriado/fin de semana, hasta 5 días antes
    for (let back = 0; back < 6 && val == null; back++) {
      const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - back)
      const p = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
      try {
        const j = await getJSON(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${kind}/${p}`)
        val = j?.[side] ?? j?.venta ?? null
      } catch (e) { if (back === 0 && e.name === 'AbortError') throw e }
    }
  }
  if (typeof val !== 'number' || !(val > 0)) throw new Error('Sin cotización')
  cache.set(key, val)
  return val
}
