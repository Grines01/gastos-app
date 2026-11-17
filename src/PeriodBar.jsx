import { useState } from 'preact/hooks'
import { label, shift, range } from './lib/period.js'
import { today, addDays } from './lib/format.js'
import { Icon, Sheet } from './ui.jsx'

const KINDS = [
  { id: 'day', label: 'Día' }, { id: 'week', label: 'Semana' }, { id: 'month', label: 'Mes' },
  { id: 'year', label: 'Año' }, { id: 'custom', label: 'Período' },
]

export function PeriodBar({ period, setPeriod }) {
  const [askRange, setAskRange] = useState(false)
  const [from, setFrom] = useState(addDays(today(), -29))
  const [to, setTo] = useState(today())
  const pick = (k) => {
    if (k === 'custom') { const [a, b] = range(period); setFrom(a); setTo(b); setAskRange(true); return }
    setPeriod({ kind: k, anchor: today() })
  }
  return (
    <div class="period">
      <div class="period-kinds" role="tablist" aria-label="Período">
        {KINDS.map((k) => <button role="tab" aria-selected={period.kind === k.id} class={period.kind === k.id ? 'on' : ''} onClick={() => pick(k.id)}>{k.label}</button>)}
      </div>
      <div class="period-nav">
        <button class="icon-btn" onClick={() => setPeriod(shift(period, -1))} aria-label="Período anterior"><Icon name="left" /></button>
        <button class="period-label" onClick={() => setPeriod({ kind: period.kind === 'custom' ? 'month' : period.kind, anchor: today() })} title="Volver a hoy">{label(period)}</button>
        <button class="icon-btn" onClick={() => setPeriod(shift(period, 1))} aria-label="Período siguiente"><Icon name="right" /></button>
      </div>
      <Sheet open={askRange} onClose={() => setAskRange(false)} title="Elegí un período">
        <div class="form">
          <label class="sel"><span>Desde</span><input type="date" value={from} onInput={(e) => setFrom(e.currentTarget.value)} /></label>
          <label class="sel"><span>Hasta</span><input type="date" value={to} onInput={(e) => setTo(e.currentTarget.value)} /></label>
          <button class="btn primary" onClick={() => { if (from && to) { setPeriod({ kind: 'custom', anchor: from, from: from <= to ? from : to, to: from <= to ? to : from }); setAskRange(false) } }}>Ver período</button>
        </div>
      </Sheet>
    </div>
  )
}
