import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'm21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z',
  upload: 'M12 15V3m0 0L7 8m5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  download: 'M12 3v12m0 0-5-5m5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  check: 'm5 12 5 5L20 7',
  filter: 'M3 5h18l-7 9v5l-4 2v-7z',
  back: 'M19 12H5m0 0 6-6m-6 6 6 6',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
}
export function Icon({ name, size = 22, stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}

export function Seg({ options, value, onChange, small }) {
  return (
    <div class={`seg${small ? ' seg-sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button type="button" role="tab" aria-selected={o.value === value} class={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

// Hojas abiertas dentro de una pantalla: el botón atrás del teléfono cierra la de arriba (ver App)
export const openSheets = []
export function Sheet({ open, onClose, children, title, full }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useLayoutEffect(() => { // al instante, para que un "atrás" inmediato ya la encuentre
    if (!open) return
    const e = { close: () => closeRef.current() }
    openSheets.push(e)
    return () => { const i = openSheets.indexOf(e); if (i >= 0) openSheets.splice(i, 1) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return (
    <div class="sheet-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`sheet${full ? ' sheet-full' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div class="sheet-head">
            <h2>{title}</h2>
            <button class="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

let toastSet = null
export function toast(msg, action) { const f = () => toastSet ? toastSet({ msg, action, id: Date.now() }) : setTimeout(f, 300); f() }
export function Toaster() {
  const [t, setT] = useState(null)
  toastSet = setT
  useEffect(() => { if (!t || t.action?.sticky) return; const h = setTimeout(() => setT(null), t.action ? 5000 : 2600); return () => clearTimeout(h) }, [t])
  if (!t) return null
  return (
    <div class="toast" role="status">
      <span>{t.msg}</span>
      {t.action && <button onClick={() => { t.action.fn(); setT(null) }}>{t.action.label}</button>}
    </div>
  )
}

export function Empty({ title, children }) {
  return <div class="empty"><p class="empty-t">{title}</p>{children && <div class="empty-b">{children}</div>}</div>
}

export function confirmDialog(msg) { return window.confirm(msg) }

export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type })
  const file = new File([blob], filename, { type })
  // en el teléfono: menú de compartir (Drive, mail, WhatsApp). Si lo cancelás, no pasa nada.
  if (navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    return navigator.share({ files: [file], title: filename }).then(() => true).catch((e) => {
      if (e?.name === 'AbortError') return false
      saveBlob(filename, blob); return true
    })
  }
  saveBlob(filename, blob)
  return Promise.resolve(true)
}
function saveBlob(filename, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
