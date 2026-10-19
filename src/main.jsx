import { render } from 'preact'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import { App } from './App.jsx'
import { registerSW } from 'virtual:pwa-register'
import { toast } from './ui.jsx'

// la versión nueva se aplica cuando el usuario quiere (o la próxima vez que abra la app), sin cortar una carga a medias
const update = registerSW({
  immediate: true,
  onNeedRefresh() { toast('Hay una versión nueva de la app', { label: 'Actualizar', fn: () => update(true), sticky: true }) },
})
render(<App />, document.getElementById('app'))
