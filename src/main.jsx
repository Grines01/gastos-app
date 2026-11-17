import { render } from 'preact'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import { App } from './App.jsx'
import { registerSW } from 'virtual:pwa-register'
import { toast } from './ui.jsx'

// Versión nueva: si aparece al abrir la app (los primeros segundos, nada a medio cargar), se aplica sola;
// si aparece con la app en uso, se ofrece con un botón para no cortar una carga a medias.
const openedAt = Date.now()
const update = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (Date.now() - openedAt < 8000) return update(true)
    toast('Hay una versión nueva de la app', { label: 'Actualizar', fn: () => update(true), sticky: true })
  },
})
render(<App />, document.getElementById('app'))
