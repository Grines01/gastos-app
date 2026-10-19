import { useEffect, useRef, useState } from 'preact/hooks'
import { useStore, load } from './lib/store.js'
import { defaultPeriod } from './lib/period.js'
import { Home } from './Home.jsx'
import { Movs } from './Movs.jsx'
import { Dashboard } from './Dashboard.jsx'
import { More } from './More.jsx'
import { TxSheet } from './TxSheet.jsx'
import { ImportFlow } from './ImportFlow.jsx'
import { Pending } from './Pending.jsx'
import { isPending } from './lib/store.js'
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
  const [pending, setPending] = useState(false)

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
  // botón "atrás" de Android: mientras haya algo abierto (pestaña, hoja, pantalla) dejamos UNA entrada
  // "trampa" en el historial; cada "atrás" la consume, cierra la capa de arriba y, si queda algo abierto, la repone.
  const layers = (tab !== 'home' ? 1 : 0) + (morePage ? 1 : 0) + (importing ? 1 : 0) + (pending ? 1 : 0) + (sheet ? 1 : 0)
  const trap = useRef(false)
  useEffect(() => { if (layers > 0 && !trap.current) { history.pushState({ trap: true }, ''); trap.current = true } }, [layers])
  useEffect(() => {
    const onPop = () => {
      trap.current = false
      if (sheet) setSheet(null)
      else if (importing) setImporting(false)
      else if (pending) setPending(false)
      else if (morePage) setMorePage(null)
      else if (tab !== 'home') setTab('home')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [sheet, importing, pending, morePage, tab])

  if (!S.ready) return <div class="boot">Cargando…</div>

  const nPending = S.txs.filter(isPending).length
  const openPending = () => setPending(true)
  const go = (t) => { setTab(t); setMorePage(null); window.scrollTo(0, 0) }

  return (
    <>
      {installEvt && !importing && !pending && (
        <div class="install-bar">
          <span>Instalá la app en tu teléfono para abrirla como cualquier otra.</span>
          <button class="btn primary sm" onClick={install}>Instalar</button>
          <button class="icon-btn sm" onClick={() => setInstallEvt(null)} aria-label="Ahora no"><Icon name="close" size={18} /></button>
        </div>
      )}
      {importing ? <ImportFlow onClose={() => setImporting(false)} onPending={() => { setImporting(false); openPending() }} />
        : pending ? <Pending onBack={() => setPending(false)} onEdit={(tx) => setSheet({ tx })} /> : (
        <>
          {tab === 'home' && <Home period={period} setPeriod={setPeriod} kind={kind} setKind={setKind} onAdd={(type) => setSheet({ type })} nPending={nPending} openPending={openPending}
            openCategory={(categoryId, k) => { if (!categoryId) return openPending(); setFilter({ ...EMPTY_FILTER, type: k, categoryId }); go('movs') }} />}
          {tab === 'movs' && <Movs period={period} setPeriod={setPeriod} filter={filter} setFilter={setFilter} onEdit={(tx) => setSheet({ tx })} onImport={() => setImporting(true)} openPending={openPending} />}
          {tab === 'dash' && <Dashboard openAccounts={() => { go('more'); setMorePage('accounts') }} />}
          {tab === 'more' && <More page={morePage} setPage={setMorePage} onImport={() => setImporting(true)} nPending={nPending} openPending={openPending} />}
          <nav class="nav" aria-label="Secciones">
            <button class={tab === 'home' ? 'on' : ''} onClick={() => go('home')}><Icon name="home" /><span>Inicio</span></button>
            <button class={tab === 'movs' ? 'on' : ''} onClick={() => go('movs')}><Icon name="list" /><span>Movimientos</span>{nPending > 0 && <i class="nav-badge" aria-label={`${nPending} sin categoría`}>{nPending > 99 ? '99+' : nPending}</i>}</button>
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
