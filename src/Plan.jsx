import { useState } from 'preact/hooks'
import { S, saveSettings, today } from './lib/store.js'
import { parseAmount, monthName } from './lib/format.js'
import { plan, planState, parsePlan, goalProgress, splitIncome, actuals, nearestScenario, dueReminders, upcomingReminders } from './lib/plan.js'
import { wealthHeadline } from './Wealth.jsx'
import { Sheet, toast, confirmDialog } from './ui.jsx'

const usd = (v) => `${v < 0 ? '−' : ''}US$ ${Math.round(Math.abs(v)).toLocaleString('es-AR')}`
const n0 = (v) => `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('es-AR')}`
const ddmm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`
const mmyy = (k) => `${monthName(+k.slice(5, 7) - 1).slice(0, 3)} ${k.slice(0, 4)}`
const WHERE = { liquido: 'Líquido', 'money-market': 'Fondo en dólares', balanz: 'Balanz' }
const STATUS = { done: 'Cumplida', ok: 'Al día', late: 'Atrasada', over: 'Te pasaste', nodata: 'Falta una foto de Patrimonio' }

const setState = (patch) => saveSettings({ planState: { ...planState(), ...patch } })
export const markDone = (key) => setState({ done: { ...(planState().done || {}), [key]: Date.now() } })

// Inicio: recordatorios que ya tocan + cómo viene el plan
export function planHeadline() {
  const p = plan()
  if (!p) return null
  const due = dueReminders(p)
  const late = p.goals.map((g) => ({ g, pr: goalProgress(g, p) })).filter((x) => x.pr.status === 'late' || x.pr.status === 'over')
  return { due, late }
}

export function PlanPage({ openWealth }) {
  const p = plan()
  const [cobro, setCobro] = useState('')
  const [edit, setEdit] = useState(null)
  const load = async (file) => {
    try {
      const np = parsePlan(JSON.parse(await file.text()))
      if (p && !confirmDialog('Ya tenés un plan cargado. ¿Reemplazarlo por el nuevo? (Lo que marcaste como hecho se conserva.)')) return
      await saveSettings({ plan: np }); toast('Plan cargado')
    } catch (e) { toast(e.message?.startsWith('No es') ? e.message : 'No pude leer el archivo') }
  }
  const picker = (label) => <label class="btn ghost file-btn">{label}<input type="file" accept=".json,application/json" onChange={(e) => e.currentTarget.files[0] && load(e.currentTarget.files[0])} /></label>
  if (!p) return (
    <>
      <p class="fine pad-x">Cargá tu plan financiero (.json): metas con fecha, cómo repartir cada cobro y recordatorios. La app sigue el avance con tus fotos de Patrimonio y tus gastos.</p>
      <div class="pad-x wl-start">{picker('Cargar archivo de plan')}</div>
      <section class="card"><WealthLink open={openWealth} /></section>
    </>
  )

  const t0 = today()
  const goals = [...p.goals].sort((a, b) => a.priority - b.priority).map((g) => ({ g, pr: goalProgress(g, p) }))
  const due = dueReminders(p), next = upcomingReminders(p)
  const late = goals.filter((x) => x.pr.status === 'late' || x.pr.status === 'over')
  const act = actuals(), sc = act.hasData ? nearestScenario(act, p) : null
  const amt = parseAmount(cobro) / 100
  const parts = amt > 0 ? splitIncome(amt, p) : []

  return (
    <>
      <div class="tiles fut-tiles">
        <div class="tile"><span class="tile-l">{p.name}</span>
          <b class={`tile-v ${late.length ? 'neg' : 'pos'}`}>{late.length ? `${late.length} ${late.length === 1 ? 'meta para mirar' : 'metas para mirar'}` : 'Vas al día'}</b>
          <span class="tile-s">{late.length ? late.map((x) => x.g.name).join(' · ') : `${goals.filter((x) => x.pr.status === 'done').length} de ${goals.length} metas cumplidas`}</span></div>
      </div>

      {due.length > 0 && (
        <section class="card pl-due">
          <h2>Te toca ahora</h2>
          <ul class="pl-rem">
            {due.map((r) => <li><span><small>{ddmm(r.date)}</small>{r.text}</span><button class="btn sm primary" onClick={() => markDone(r.key)}>Hecho</button></li>)}
          </ul>
        </section>
      )}

      <section class="card">
        <h2>Metas</h2>
        <ul class="pl-goals">
          {goals.map(({ g, pr }) => (
            <li>
              <button class="pl-goal" onClick={() => g.kind !== 'budget' && g.source === 'manual' && setEdit(g)}>
                <span class="pl-top"><b>{g.name}</b><em class={`pl-st st-${pr.status}`}>{STATUS[pr.status]}</em></span>
                {pr.current != null && (
                  <>
                    <span class="pl-bar"><i class={`st-${pr.status}`} style={{ width: `${Math.min(100, Math.max(0, pr.pct * 100))}%` }} />{!pr.budget && pr.status !== 'done' && pr.expected > 0 && <u style={{ left: `${Math.min(100, (pr.expected / g.amountUsd) * 100)}%` }} title="Donde deberías estar hoy" />}</span>
                    <span class="pl-nums"><span class="num">{usd(pr.current)} de {usd(g.amountUsd)}</span><span>{g.kind === 'budget' ? 'tope' : 'para'} {mmyy(g.due)}</span></span>
                    <span class="pl-sub">
                      {pr.budget ? (pr.status === 'over' ? `Te pasaste por ${usd(-pr.left)}.` : `Te quedan ${usd(pr.left)}.`)
                        : pr.status === 'done' ? 'Cumplida: lo que iba acá pasa a la siguiente meta.'
                        : <>Faltan {usd(pr.left)}: <b class="num">{usd(pr.needMonthly)} por mes</b>{pr.status === 'late' ? ` (vas ${usd(pr.behind)} por debajo de lo previsto)` : ''}.</>}
                      {' '}{WHERE[g.where] || g.where}{g.kind !== 'budget' && g.source === 'manual' ? ' · tocá para actualizar' : ''}
                    </span>
                  </>
                )}
                {pr.current == null && <span class="pl-sub">Sacá una foto en Más → Patrimonio para ver el avance.</span>}
                {g.note && <span class="pl-note">{g.note}</span>}
              </button>
            </li>
          ))}
        </ul>
        <WealthLink open={openWealth} />
        <p class="fine">La raya marca dónde deberías estar hoy. El fondo de emergencia y la inversión se actualizan con cada foto de Patrimonio; vacaciones y muebles, con tus gastos.</p>
      </section>

      {p.split?.length > 0 && (
        <section class="card">
          <h2>Repartir un cobro</h2>
          <p class="fine">Cuando entra una comisión, escribila y te digo cuánto va a cada lado.</p>
          <label class="sel"><span>Comisión cobrada</span><span class="affix"><i>US$</i><input inputmode="decimal" value={cobro} placeholder="0" onInput={(e) => setCobro(e.currentTarget.value)} /></span></label>
          {parts.length > 0 && (
            <ul class="pl-split">
              {parts.map((r) => <li><span>{r.label}<small>{r.pct}%{r.moved.length ? ` · incluye lo de ${r.moved.join(' y ')} (ya cumplida)` : ''}</small></span><b class="num">{usd(r.usd)}</b></li>)}
            </ul>
          )}
        </section>
      )}

      {p.scenario && (
        <details class="card pl-fold">
          <summary><h2>Escenarios</h2>{sc && <small>estás cerca del {sc}</small>}</summary>
          <div class="fx-table" role="table">
            <div class="fx-row fx-h" role="row"><span>US$/mes</span><span>Ingreso</span><span>Gasto</span><span>Ahorro</span></div>
            {[['conservative', 'Conservador'], ['base', 'Base'], ['optimistic', 'Optimista']].filter(([k]) => p.scenario[k]).map(([k, n]) => (
              <div class="fx-row" role="row"><span>{n}</span><span class="num">{n0(p.scenario[k].incomeUsd)}</span><span class="num">{n0(p.scenario[k].spendUsd)}</span><b class={`num ${p.scenario[k].saveUsd < 0 ? 'neg' : ''}`}>{n0(p.scenario[k].saveUsd)}</b></div>
            ))}
            {act.hasData && <div class="fx-row pl-act" role="row"><span>Vos (3 m)</span><span class="num">{n0(act.incomeUsd)}</span><span class="num">{n0(act.spendUsd)}</span><b class={`num ${act.saveUsd < 0 ? 'neg' : ''}`}>{n0(act.saveUsd)}</b></div>}
          </div>
          {sc && <p class="fine">Por tus ingresos de los últimos 3 meses completos, estás más cerca del escenario <b>{sc}</b>.</p>}
        </details>
      )}

      {p.rules?.length > 0 && (
        <details class="card pl-fold">
          <summary><h2>Tus reglas</h2><small>{p.rules.length}</small></summary>
          <ol class="pl-rules">{p.rules.map((r) => <li>{r}</li>)}</ol>
        </details>
      )}

      {next.length > 0 && (
        <section class="card">
          <h2>Próximos recordatorios</h2>
          <ul class="pl-rem next">{next.map((r) => <li><span><small>{ddmm(r.date)}/{r.date.slice(2, 4)}</small>{r.text}</span></li>)}</ul>
          <p class="fine">Aparecen en Inicio el día que tocan{S.settings.notify ? ' y te llega una notificación' : '. Si activás los avisos (Más → Tarjetas), también te llega una notificación'}.</p>
        </section>
      )}

      <div class="pad-x rv-foot">{picker('Cargar otro plan')}</div>
      <GoalSheet key={edit?.id || 'none'} g={edit} onClose={() => setEdit(null)} />
    </>
  )
}

function WealthLink({ open }) {
  if (!open) return null
  const w = wealthHeadline()
  return <button class="pl-wealth" onClick={open}><span>Patrimonio{w ? <b class="num"> US$ {Math.round(w.net / 100).toLocaleString('es-AR')}</b> : ''}<small>{w ? `netos al ${w.date.slice(8)}/${w.date.slice(5, 7)} · tocá para sacar una foto nueva` : 'Tus saldos reales: cuentas, inversiones y tarjetas'}</small></span><i>›</i></button>
}

function GoalSheet({ g, onClose }) {
  const [v, setV] = useState(null) // se reinicia sola: la hoja lleva key={id de la meta}
  if (!g) return null
  const cur = planState().saved?.[g.id] ?? g.startUsd ?? 0
  const val = v ?? String(Math.round(cur))
  const save = async () => { const n = parseAmount(val) / 100; if (!(n >= 0)) return toast('Poné un monto'); await setState({ saved: { ...(planState().saved || {}), [g.id]: n } }); onClose(); toast('Meta actualizada') }
  return (
    <Sheet open title={g.name} onClose={onClose}>
      <div class="form">
        <p class="fine">¿Cuánto llevás apartado para esta meta?</p>
        <label class="sel"><span>Apartado hasta hoy</span><span class="affix"><i>US$</i><input inputmode="decimal" value={val} onInput={(e) => setV(e.currentTarget.value)} /></span></label>
        <button class="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  )
}
