import { render } from 'preact'
import '@fontsource-variable/bricolage-grotesque'
import './styles.css'
import { App } from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })
render(<App />, document.getElementById('app'))
