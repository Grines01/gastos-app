import { useEffect, useState } from 'preact/hooks'
import { useStore, load } from './lib/store.js'
import { defaultPeriod } from './lib/period.js'
import { Home } from './Home.jsx'
import { Movs } from './Movs.jsx'
import { Dashboard } from './Dashboard.jsx'
import { More } from './More.jsx'
import { TxSheet } from './TxSheet.jsx'
import { ImportFlow } from './ImportFlow.jsx'
import { Icon, Toaster } from './ui.jsx'

const EMPTY_FILTER = { type: 'all', categoryId: null, accountId: null, tagId: null, q: '' }

export function App() {
  const S = useStore()
  const [tab, setTab] = useState('home')
  const [period, setPeriod] = useState(defaultPeriod())
  const [kind, setKind] = useState('expense')
  const [filter, setFilter] = useState(EMPTY_FILTER)
  const [sheet, setSheet] = useState(null) // { tx?, type }
  const [importing, setImporting] = useState(false)
  const [morePage, setMorePage] = useState(null)

  useEffect(() => { load() }, [])
  // botón "Instalar app" (Chrome en Android ofrece el evento beforeinstallprompt)
  const [installEvt, setInstallEvt] = useState(null)
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e) }
    const onInstalled = () => setInstallEvt(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled) }
  }, [])
  const install = async () => { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null) }
  // botón "atrás" de Android cierra hojas y vuelve a Inicio
  useEffect(() => {
    const open = sheet || importing || morePage || tab !== 'home'
    if (open && history.state?.layer !== 1) history.pushState({ layer: 1 }, '')
    const onPop = () => {
      if (sheet) setSheet(null)
      else if (importing) setImporting(false)
      else if (morePage) setMorePage(null)
      else setTab('home')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [sheet, importing, morePage, tab])

  if (!S.ready) return <div class="boot">Cargando…</div>

  const go = (t) => { setTab(t); setMorePage(null); window.scrollTo(0, 0) }

  return (
    <>
      {installEvt && !importing && (
        <div class="install-bar">
          <span>Instalá la app en tu teléfono para abrirla como cualquier otra.</span>
          <button class="btn primary sm" onClick={install}>Instalar</button>
          <button class="icon-btn sm" onClick={() => setInstallEvt(null)} aria-label="Ahora no"><Icon name="close" size={18} /></button>
        </div>
      )}
      {importing ? <ImportFlow onClose={() => setImporting(false)} /> : (
        <>
          {tab === 'home' && <Home period={period} setPeriod={setPeriod} kind={kind} setKind={setKind} onAdd={(type) => setSheet({ type })}
            openCategory={(categoryId, k) => { setFilter({ ...EMPTY_FILTER, type: k, categoryId: categoryId || 'none' }); go('movs') }} />}
          {tab === 'movs' && <Movs period={period} setPeriod={setPeriod} filter={filter} setFilter={setFilter} onEdit={(tx) => setSheet({ tx })} onImport={() => setImporting(true)} />}
          {tab === 'dash' && <Dashboard openAccounts={() => { go('more'); setMorePage('accounts') }} />}
          {tab === 'more' && <More page={morePage} setPage={setMorePage} onImport={() => setImporting(true)} />}
          <nav class="nav" aria-label="Secciones">
            <button class={tab === 'home' ? 'on' : ''} onClick={() => go('home')}><Icon name="home" /><span>Inicio</span></button>
            <button class={tab === 'movs' ? 'on' : ''} onClick={() => go('movs')}><Icon name="list" /><span>Movimientos</span></button>
            <button class="fab" onClick={() => setSheet({ type: tab === 'home' ? kind : 'expense' })} aria-label="Cargar movimiento"><Icon name="plus" size={28} stroke={2.5} /></button>
            <button class={tab === 'dash' ? 'on' : ''} onClick={() => go('dash')}><Icon name="chart" /><span>Resumen</span></button>
            <button class={tab === 'more' ? 'on' : ''} onClick={() => go('more')}><Icon name="more" /><span>Más</span></button>
          </nav>
        </>
      )}
      <TxSheet open={!!sheet} tx={sheet?.tx} initialType={sheet?.type || 'expense'} onClose={() => setSheet(null)} />
      <Toaster />
    </>
  )
}
