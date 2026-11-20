import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { getLocale, msg, subscribeLocale } from '../../../shared/i18n'

type Entry = { id: string; message: string; error: boolean; dismiss: () => void }
type Registry = { put: (entry: Entry) => void; remove: (id: string) => void }
const Context = createContext<Registry | null>(null)

// Operation feedback has no layout box in its source page. Unmounting the source
// removes its feedback as well, including when the vault locks or navigation changes.
export function Toast({ message, error = false, onDismiss }: { message: string; error?: boolean; onDismiss: () => void }) {
  const registry = useContext(Context)
  const id = useId(), dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (!registry || !message) return
    const key = id
    registry.put({ id: key, message, error, dismiss: () => { registry.remove(key); dismiss.current() } })
    return () => registry.remove(key)
  }, [registry, message, error, id])
  return null
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const put = useCallback((entry: Entry) => setEntries(old => [...old.filter(item => item.id !== entry.id), entry]), [])
  const remove = useCallback((id: string) => setEntries(old => old.some(item => item.id === id) ? old.filter(item => item.id !== id) : old), [])
  const registry = useMemo(() => ({ put, remove }), [put, remove])
  return <Context.Provider value={registry}>{children}<ToastLayer entries={entries}/></Context.Provider>
}

function ToastLayer({ entries }: { entries: Entry[] }) {
  useSyncExternalStore(subscribeLocale, getLocale)
  const [target, setTarget] = useState<Element>(document.body)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const update = () => setTarget([...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body)
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    // A manual popover occupies the native top layer without blocking the page or
    // stealing focus. Mount inside the active modal so feedback stays interactive.
    const node = ref.current
    if (entries.length && node?.isConnected && !node.matches(':popover-open')) node.showPopover()
  }, [target, entries.length])
  if (!entries.length) return null
  return createPortal(<div ref={ref} className="app-toast-stack" popover="manual" aria-label={msg('feedback.notifications')}>
    {entries.map(entry => <ToastCard key={entry.id} entry={entry}/>)}
  </div>, target)
}
function ToastCard({ entry }: { entry: Entry }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const remaining = useRef(4500)
  useEffect(() => { remaining.current = 4500 }, [entry.message, entry.error])
  useEffect(() => {
    if (entry.error || paused) return
    const started = performance.now()
    const timer = window.setTimeout(entry.dismiss, remaining.current)
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)) }
  }, [entry, paused])
  return <div className={`app-toast${entry.error ? ' is-error' : ''}`} role={entry.error ? 'alert' : 'status'} aria-atomic="true"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    {entry.error ? <CircleAlert size={18} aria-hidden="true"/> : <CheckCircle2 size={18} aria-hidden="true"/>}
    <span>{entry.message}</span><button type="button" aria-label={msg('agentWorkspace.dismissMessage')} onClick={entry.dismiss}><X size={15}/></button>
  </div>
}
