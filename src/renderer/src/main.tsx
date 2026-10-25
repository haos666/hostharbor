import { msg, getLocale, setLocale, subscribeLocale } from '../../shared/i18n'
import { NotificationSettings } from './components/NotificationSettings'
import harborWordmark from '../../../resources/branding/wordmark-light.svg'
import harborMark from '../../../resources/branding/mark.svg'
import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppStatus, CredentialSummary, Section, ServerRecord, ApprovalNavigation, ApprovalReminder } from '../../shared/contracts'
import { Activity, Bot, ScrollText, KeyRound, Server, Settings } from 'lucide-react'
import { AiSettings } from './components/AiSettings'
import { HistoryPage } from './components/HistoryPage'
import { RecordingSettings } from './components/RecordingSettings'
import { AgentWorkspace } from './components/AgentWorkspace'
import { ApprovalSettings } from './components/ApprovalSettings'
import { SecuritySettings } from './components/SecuritySettings'
import { CredentialsPage } from './components/CredentialsPage'
import { ServersPage } from './components/ServersPage'
import { LanguageSettings } from './components/LanguageSettings'
import { SettingsLayout, type SettingsPage } from './components/SettingsLayout'
import './styles.css'
import './polish.css'

const api = window.hostharbor
const sections: { id: Section; label: string; description: string }[] = [
  { id: 'servers', get label() { return msg('navigation.servers') }, get description() { return msg('main.saveSshConnectionsVerifyHostFingerprintsAndTest') } },
  { id: 'credentials', get label() { return msg('credentialsPage.credentials') }, get description() { return msg('main.manageReusablePasswordsAndPrivateKeysWithoutPlaintext') } },
  { id: 'connections', get label() { return msg('agentWorkspace.agentAccess') }, get description() { return msg('main.localAuthorization') } },
  { id: 'operations', get label() { return msg('agentWorkspace.approvals') }, get description() { return msg('main.commandApprovalAndExecution') } },
  { id: 'audit', get label() { return msg('historyPage.operationLogs') }, get description() { return msg('main.historySearchAndOutputReplay') } },
  { id: 'settings', get label() { return msg('aiSettings.settings') }, get description() { return msg('securitySettings.securitySettings') } },
]

function App() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale)
  useEffect(() => api.onLanguageChanged(settings => setLocale(settings.locale)), [])
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const [settingsTab, setSettingsTab] = useState<SettingsPage>('language')
  const [approvalNavigation, setApprovalNavigation] = useState<ApprovalNavigation | null>(null)
  const [reminder, setReminder] = useState<ApprovalReminder | null>(null)
  const [active, setActive] = useState<Section>('servers')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const mainPane = useRef<HTMLElement>(null)
  const generation = useRef(0)
  const unlocked = status?.vault === 'unlocked'
  useEffect(() => {
    const root = document.documentElement
    root.dataset.focusMethod = 'keyboard'
    const pointer = () => { root.dataset.focusMethod = 'pointer' }
    const keyboard = (event: KeyboardEvent) => {
      if (['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(event.key)) root.dataset.focusMethod = 'keyboard'
    }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', keyboard, true) }
  }, [])


  function clearPrivateView() {
    setServers([]); setCredentials([])
  }
  async function refresh() {
    const epoch = generation.current
    const next = await api.getStatus()
    if (epoch !== generation.current) return
    setStatus(next)
    if (next.vault !== 'unlocked') { clearPrivateView(); return }
    const [serverResult, credentialResult] = await Promise.all([api.listServers(), api.listCredentials()])
    if (epoch !== generation.current) return
    if (serverResult.ok && credentialResult.ok) { setServers(serverResult.value); setCredentials(credentialResult.value) }
    else { clearPrivateView() }
  }
  useEffect(() => {
    let disposed = false
    const update = () => { if (!disposed) void refresh().catch(() => { if (!disposed) { setStatus(old => old ? { ...old, core: 'unavailable', pendingApprovals: 0 } : old); setReminder(null); setMessage({ error: true, text: msg('main.cannotReadCoreStatusRestartTheAppAnd') }) } }) }
    update()
    const timer = window.setInterval(update, 2000)
    return () => { disposed = true; generation.current++; window.clearInterval(timer) }
  }, [])
  useEffect(() => api.onVaultLocked(() => {
    generation.current++; clearPrivateView(); setReminder(null)
    setStatus(old => old ? { ...old, vault: 'locked', backgroundMcp: false, lockRevision: old.lockRevision + 1 } : old)
  }), [])
  useEffect(() => {
    const navigate = () => { void api.takeApprovalNavigation().then(result => { if (result.ok && result.value) { setApprovalNavigation(result.value); setActive('operations'); setReminder(null); setMessage(null) } }).catch(() => {}) }
    const unsubscribe = api.onApprovalNavigation(navigate)
    const reminders = api.onApprovalReminder(value => setReminder(value))
    navigate()
    return () => { unsubscribe(); reminders() }
  }, [])
  useEffect(() => { if (!unlocked) setReminder(null) }, [unlocked, status?.lockRevision])
  useEffect(() => { mainPane.current?.scrollTo({ top: 0 }) }, [active, settingsTab])
  return <div className="app-shell">
    <aside>
      <div className="brand"><img className="brand-icon" src={harborMark} alt="" /><img className="brand-wordmark" src={harborWordmark} alt="HostHarbor" /></div>
      <nav aria-label={msg('main.mainNavigation')}>{sections.filter(item => item.id !== 'settings').map((item) => <button key={item.id} aria-current={active === item.id ? 'page' : undefined} onClick={() => { setActive(item.id); setMessage(null) }}>{item.id === 'connections' ? <Bot size={17} /> : item.id === 'operations' ? <Activity size={17} /> : item.id === 'servers' ? <Server size={17} /> : item.id === 'audit' ? <ScrollText size={17} /> : <KeyRound size={17} />}{item.label}{item.id === 'operations' && !!status?.pendingApprovals && <span className="approval-count" aria-label={msg('main.valuePendingApprovals', { value0: status.pendingApprovals })}>{status.pendingApprovals}</span>}</button>)}</nav>
      <nav className="sidebar-footer" aria-label={msg('main.system')}><button aria-current={active === 'settings' ? 'page' : undefined} onClick={() => { setActive('settings'); setMessage(null) }}><Settings size={17} />{msg('aiSettings.settings')}</button></nav>
    </aside>
    {unlocked && reminder && (status?.pendingApprovals ?? 0) > 0 && <div className="approval-reminder" role="status"><div><strong>{msg('main.newOperationsAwaitApproval')}</strong><span>{status?.pendingApprovals} {msg('main.pending')}</span></div><button onClick={() => { setActive('operations'); setApprovalNavigation({ sequence: Date.now(), operationId: reminder.operationId }); setReminder(null) }}>{msg('main.openApprovals')}</button><button aria-label={msg('main.dismissApprovalReminder')} onClick={() => setReminder(null)}>×</button></div>}
    <main ref={mainPane} className={`credentials-main ${active}-main${(active === 'audit' || active === 'operations') && unlocked ? ' history-main' : ''}`}>
      {!status ? <div className="app-loading" role="status">{msg('main.loadingLocalWorkspace')}</div> : active === 'audit' ? <HistoryPage status={status} onRefresh={refresh} onSetup={() => { setSettingsTab('security'); setActive('settings') }} /> : active === 'connections' || active === 'operations' ? <AgentWorkspace notificationTarget={approvalNavigation} onNotificationHandled={sequence => setApprovalNavigation(old => old?.sequence === sequence ? null : old)} kind={active} status={status} servers={servers} onRefresh={refresh} onSetup={() => { setSettingsTab('security'); setActive('settings') }} /> : active === 'settings' ? <SettingsLayout active={settingsTab} onSelect={setSettingsTab}>{settingsTab === 'language' ? <LanguageSettings /> : settingsTab === 'notifications' ? <NotificationSettings /> : settingsTab === 'security' ? <SecuritySettings status={status} onRefresh={refresh} /> : settingsTab === 'ai' ? <AiSettings status={status} onRefresh={refresh} onSetup={() => setSettingsTab('security')} /> : settingsTab === 'recordings' ? <RecordingSettings status={status} onRefresh={refresh} onSetup={() => setSettingsTab('security')} /> : <ApprovalSettings status={status} servers={servers} onRefresh={refresh} onSetup={() => setSettingsTab('security')} />}</SettingsLayout> : active === 'credentials' ? <CredentialsPage status={status} credentials={credentials} servers={servers} busy={false} message={message} onDismissMessage={() => setMessage(null)} onRefresh={refresh} onSetup={() => { setSettingsTab('security'); setActive('settings') }} /> : <ServersPage status={status} credentials={credentials} servers={servers} message={message} onDismissMessage={() => setMessage(null)} onRefresh={refresh} onSetup={() => { setSettingsTab('security'); setActive('settings') }} />}

    </main>
  </div>
}

void api.getLanguage().then(result => { if (result.ok) setLocale(result.value.locale) }).catch(() => {}).finally(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
})
