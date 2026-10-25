import { useState, useRef } from 'preact/hooks'
import { money, compactMoney } from './lib/format.js'

// ---------- Torta (dona) ----------
export function Donut({ data, total, selected, onSelect, center, fmt = (v) => money(v, { decimals: false }) }) {
  const size = 200, r = 84, w = 26, cx = size / 2, cy = size / 2
  let acc = 0
  const sum = data.reduce((s, d) => s + d.value, 0) || 1
  const arcs = data.map((d) => {
    const a0 = (acc / sum) * Math.PI * 2; acc += d.value
    const a1 = (acc / sum) * Math.PI * 2
    return { ...d, a0, a1 }
  })
  const pt = (a, rad) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)]
  const path = (a0, a1) => {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r)
    return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
  }
  const sel = arcs.find((a) => a.id === selected)
  return (
    <div class="donut">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribución por categoría">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" stroke-width={w} />
        {arcs.map((a) => (
          <path d={path(a.a0, a.a1)} fill="none" stroke={a.color} stroke-width={a.id === selected ? w + 8 : w}
            class="donut-arc" opacity={selected && a.id !== selected ? 0.35 : 1}
            onClick={() => onSelect?.(a.id === selected ? null : a.id)}>
            <title>{`${a.label}: ${fmt(a.value)}`}</title>
          </path>
        ))}
        {/* separadores de 2px del color de superficie */}
        {arcs.length > 1 && arcs.map((a) => { const [x0, y0] = pt(a.a0, r - w / 2 - 6), [x1, y1] = pt(a.a0, r + w / 2 + 6); return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--bg)" stroke-width="2" pointer-events="none" /> })}
      </svg>
      <div class="donut-center" aria-live="polite">
        {sel ? (<><span class="dc-label">{sel.label}</span><span class="dc-val num">{fmt(sel.value)}</span><span class="dc-sub">{Math.round((sel.value / sum) * 100)}%</span></>)
          : center}
      </div>
    </div>
  )
}

// ---------- Barras agrupadas (ingresos vs gastos por mes) ----------
// opcionales: fmt(v) para el globo, extra(d) para agregar una línea al globo
export function Bars({ data, series, fmt = (v) => money(v, { decimals: false }), extra }) {
  const [hi, setHi] = useState(null)
  const W = 340, Hh = 180, padL = 46, padB = 22, padT = 10
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key])))
  const nice = niceMax(max)
  const plotW = W - padL - 4, plotH = Hh - padB - padT
  const gw = plotW / data.length
  const bw = Math.max(3, Math.min(12, (gw - 6) / series.length - 2))
  const y = (v) => padT + plotH - (v / nice) * plotH
  const ticks = [0, nice / 2, nice]
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Ingresos y gastos por mes">
        {ticks.map((t) => (<g><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--grid)" stroke-width="1" /><text x={padL - 6} y={y(t) + 4} class="tick" text-anchor="end">{compactMoney(t).replace('$ ', '')}</text></g>))}
        {data.map((d, i) => {
          const gx = padL + i * gw + (gw - series.length * (bw + 2)) / 2
          return (
            <g onClick={() => setHi(hi === i ? null : i)} class="hit">
              <rect x={padL + i * gw} y={padT} width={gw} height={plotH + padB} fill="transparent" />
              {hi === i && <rect x={padL + i * gw + 1} y={padT} width={gw - 2} height={plotH} fill="var(--hover)" rx="4" />}
              {series.map((s, k) => {
                const v = d[s.key]; const top = y(v); const h = Math.max(0, padT + plotH - top)
                return h > 0 ? <path d={roundTop(gx + k * (bw + 2), top, bw, h, Math.min(4, bw / 2, h))} fill={s.color} /> : null
              })}
              <text x={padL + i * gw + gw / 2} y={Hh - 6} class="tick" text-anchor="middle">{d.label}</text>
            </g>
          )
        })}
        <line x1={padL} x2={W} y1={padT + plotH} y2={padT + plotH} stroke="var(--axis)" stroke-width="1" />
      </svg>
      {hi !== null && (
        <div class="tip">
          <strong>{data[hi].full}</strong>
          {series.map((s) => <span><i style={{ background: s.color }} />{s.label}: <b class="num">{fmt(data[hi][s.key])}</b></span>)}
          {extra?.(data[hi])}
        </div>
      )}
    </div>
  )
}
// ---------- Barras apiladas (cuotas por tarjeta y por mes) ----------
// Una barra por mes; cada tramo es una serie, en el orden fijo de `series`. 2px de separación entre tramos.
// opcionales: onPick(serie, i) hace tocables los tramos y las filas del globo; onSel(i) avisa qué mes está elegido
export function StackBars({ data, series, fmt = (v) => money(v, { decimals: false }), totalLabel = "Total", onPick, onSel }) {
  const [hi, setHi0] = useState(null)
  const setHi = (i) => { setHi0(i); onSel?.(i) }
  const W = 340, Hh = 170, padL = 46, padB = 22, padT = 10
  const tot = (d) => series.reduce((s, x) => s + (d[x.key] || 0), 0)
  const nice = niceMax(Math.max(1, ...data.map(tot)))
  const plotW = W - padL - 4, plotH = Hh - padB - padT
  const gw = plotW / data.length, bw = Math.min(26, gw * 0.62)
  const h = (v) => (v / nice) * plotH
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Cuotas por mes y tarjeta">
        {[0, nice / 2, nice].map((t) => { const yy = padT + plotH - h(t); return <g><line x1={padL} x2={W} y1={yy} y2={yy} stroke="var(--grid)" /><text x={padL - 6} y={yy + 4} class="tick" text-anchor="end">{compactMoney(t).replace('$ ', '')}</text></g> })}
        {data.map((d, i) => {
          const x = padL + i * gw + (gw - bw) / 2
          let base = padT + plotH
          const segs = series.filter((sr) => d[sr.key] > 0)
          return (
            <g class="hit" onClick={() => setHi(hi === i ? null : i)} opacity={d.dim ? 0.5 : undefined}>
              <rect x={padL + i * gw} y={padT} width={gw} height={plotH + padB} fill="transparent" />
              {hi === i && <rect x={padL + i * gw + 1} y={padT} width={gw - 2} height={plotH} fill="var(--hover)" rx="4" />}
              {segs.map((sr, k) => {
                const hh = h(d[sr.key]); const top = base - hh; const last = k === segs.length - 1
                const gap = k > 0 ? 2 : 0 // separación del color de fondo entre tramos
                // con onPick, tocar el tramo abre su detalle (el área tocable es todo el ancho de la columna)
                const pick = onPick && ((e) => { e.stopPropagation(); setHi(i); onPick(sr.key, i) })
                const el = last
                  ? <path d={roundTop(x, top, bw, Math.max(0, hh - gap), Math.min(4, Math.max(0, hh - gap) / 2))} fill={sr.color} />
                  : <rect x={x} y={top} width={bw} height={Math.max(0, hh - gap)} fill={sr.color} />
                if (pick) { base = top; return <g class="seg" data-key={sr.key} onClick={pick}><rect x={padL + i * gw} y={top} width={gw} height={hh} fill="transparent" />{el}</g> }
                base = top
                return el
              })}
              <text x={padL + i * gw + gw / 2} y={Hh - 6} class="tick" text-anchor="middle">{d.label}</text>
            </g>
          )
        })}
        <line x1={padL} x2={W} y1={padT + plotH} y2={padT + plotH} stroke="var(--axis)" />
      </svg>
      {hi !== null && (
        <div class="tip">
          <strong>{data[hi].full}</strong>
          {series.filter((sr) => data[hi][sr.key] > 0).map((sr) => onPick
            ? <button class="tip-row" onClick={() => onPick(sr.key, hi)}><i style={{ background: sr.color }} />{sr.label}: <b class="num">{fmt(data[hi][sr.key])}</b><span class="tip-go" aria-hidden="true">›</span></button>
            : <span><i style={{ background: sr.color }} />{sr.label}: <b class="num">{fmt(data[hi][sr.key])}</b></span>)}
          <span class="tip-wide">{totalLabel}: <b class="num">{fmt(tot(data[hi]))}</b></span>
        </div>
      )}
    </div>
  )
}

function roundTop(x, y, w, h, r) {
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`
}
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

// ---------- Líneas: gasto acumulado del mes ----------
// opcionales: fit (eje Y ajustado al rango, no desde 0), tick(v) para el eje Y, xTick(i) para el eje X,
// fmt(v) para el globo, extra(i) para agregar contenido al globo
export function Lines({ series, days, xLabel, fit, tick, xTick, fmt, extra, label = 'Gasto acumulado' }) {
  const [hi, setHi] = useState(null)
  const ref = useRef()
  const W = 340, Hh = 180, padL = 46, padB = 22, padT = 12, padR = 8
  const vals = series.flatMap((s) => s.values.filter((v) => v != null))
  let max = niceMax(Math.max(1, ...vals)), min = 0
  if (fit && vals.length) {
    const hi = Math.max(...vals), lo = Math.min(...vals), step = niceMax(Math.max(1, (hi - lo) / 2))
    min = Math.max(0, Math.floor(lo / step) * step); max = Math.ceil(hi / step) * step
    if (max - min < step * 2) max = min + step * 2
  }
  const plotW = W - padL - padR, plotH = Hh - padT - padB
  const x = (i) => padL + (i / (days - 1)) * plotW
  const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH
  const tk = tick || ((t) => compactMoney(t).replace('$ ', ''))
  const ff = fmt || ((v) => money(v, { decimals: false }))
  const pathOf = (vals) => vals.map((v, i) => (v == null ? '' : `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).join('')
  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    setHi(Math.max(0, Math.min(days - 1, Math.round(((px - padL) / plotW) * (days - 1)))))
  }
  return (
    <div class="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={label} onPointerDown={onMove} onPointerMove={(e) => e.buttons || e.pointerType === 'mouse' ? onMove(e) : null} onPointerLeave={(e) => e.pointerType === 'mouse' && setHi(null)}>
        {[min, (min + max) / 2, max].map((t) => (<g><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={padL - 6} y={y(t) + 4} class="tick" text-anchor="end">{tk(t)}</text></g>))}
        {[0, Math.floor((days - 1) / 2), days - 1].map((i) => <text x={x(i)} y={Hh - 6} class="tick" text-anchor={i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle'}>{xTick ? xTick(i) : i + 1}</text>)}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="var(--axis)" />
        {series.map((s) => <path d={pathOf(s.values)} fill="none" stroke={s.color} stroke-width="2" stroke-dasharray={s.dashed ? '4 4' : null} stroke-linejoin="round" stroke-linecap="round" />)}
        {series.map((s) => { const li = lastIdx(s.values); return li >= 0 ? <circle cx={x(li)} cy={y(s.values[li])} r="4" fill={s.color} stroke="var(--bg)" stroke-width="2" /> : null })}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + plotH} stroke="var(--axis)" />}
        {hi !== null && series.map((s) => s.values[hi] != null && <circle cx={x(hi)} cy={y(s.values[hi])} r="4" fill={s.color} stroke="var(--bg)" stroke-width="2" />)}
      </svg>
      {hi !== null && (
        <div class="tip">
          <strong>{xLabel(hi + 1)}</strong>
          {series.map((s) => s.values[hi] != null && <span><i style={{ background: s.color }} />{s.label}: <b class="num">{ff(s.values[hi])}</b></span>)}
          {extra && extra(hi)}
        </div>
      )}
    </div>
  )
}
const lastIdx = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i; return -1 }

// ---------- Barras horizontales ----------
// total: si se pasa, cada barra es la parte de ese total (ej. % del gasto del mes); si no, relativa a la mayor
export function HBars({ rows, color, total }) {
  const max = total > 0 ? total : Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul class="hbars">
      {rows.map((r) => (
        <li>
          <div class="hb-top"><span>{r.label}{r.note && <small> · {r.note}</small>}</span><span class="num">{money(r.value, { decimals: false })}</span></div>
          <div class="hb-track"><div class="hb-fill" style={{ width: `${Math.min(100, Math.max(1.5, (r.value / max) * 100))}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  )
}

export function Legend({ items }) {
  const dot = (s) => <i class={s.dashed ? 'dash' : ''} style={{ background: s.dashed ? 'none' : s.color, borderColor: s.color }} />
  return <div class="legend">{items.map((s) => s.onClick ? <button class="legend-btn" onClick={s.onClick}>{dot(s)}{s.label}</button> : <span>{dot(s)}{s.label}</span>)}</div>
}
