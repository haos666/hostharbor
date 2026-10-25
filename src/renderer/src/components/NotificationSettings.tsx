import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useState } from 'react'
import type { NotificationPreferences, NotificationSettingsState, NotificationDelivery } from '../../../shared/contracts'
import type { Result } from '../../../shared/errors'
const api = window.hostharbor
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(errorText(result.error)); return result.value }
const deliveryMessage = (delivery: NotificationDelivery) => delivery === 'shown' ? msg('notificationSettings.theSystemReportedThatTheNotificationWasShown') : delivery === 'failed' ? msg('notificationSettings.systemNotificationFailedCheckNotificationPermissionsMacosAlso') : msg('notificationSettings.notificationSubmittedButBannerDisplayIsUnconfirmedCheck')
export function NotificationSettings() {
  const [state, setState] = useState<NotificationSettingsState | null>(null)
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => { let disposed = false; void api.getNotificationSettings().then(result => { if (disposed) return; const value = unwrap(result); setState(value); setDraft(value.preferences) }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : msg('notificationSettings.cannotReadNotificationSettings')) }); return () => { disposed = true } }, [])
  async function run(kind: 'save' | 'test' | 'reload') {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (kind === 'test') { const delivery = unwrap(await api.testNotification()); if (delivery === 'failed') setError(deliveryMessage(delivery)); else setMessage(deliveryMessage(delivery)); return }
      const next = unwrap(kind === 'save' ? await api.saveNotificationSettings(draft!) : await api.getNotificationSettings())
      setState(next); setDraft(next.preferences); if (kind === 'save') setMessage(msg('notificationSettings.notificationSettingsSaved'))
    } catch (e) { setError(e instanceof Error ? e.message : msg('notificationSettings.notificationActionIncomplete')) }
    finally { setBusy(false) }
  }
  const dirty = !!state && !!draft && (state.preferences.badge !== draft.badge || state.preferences.system !== draft.system || state.preferences.sound !== draft.sound)
  return <section className="notification-settings"><header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('aiSettings.settings')}</span><h1>{msg('notificationSettings.notifications')}</h1></div></header>
    {error && <p className="drawer-error" role="alert">{error}</p>}{message && <p className="credential-notice" role="status">{message}</p>}
    {draft && <form onSubmit={event => { event.preventDefault(); void run('save') }}><div className="security-card">
      {([{ key: 'badge', title: msg('notificationSettings.approvalBadge'), description: msg('notificationSettings.showAnAppTaskbarBadgeAndPendingCount') }, { key: 'system', title: msg('notificationSettings.systemNotifications'), description: msg('notificationSettings.combineNewApprovalRemindersWhileTheAppIs') }, { key: 'sound', title: msg('notificationSettings.notificationSound'), description: msg('notificationSettings.allowTheDefaultSystemNotificationSoundPlaybackAlso') }] as const).map(item => <label className="security-setting notification-setting" key={item.key}><div><h2>{item.title}</h2><p>{item.description}</p></div><input type="checkbox" role="switch" aria-label={item.title} checked={draft[item.key]} disabled={busy} onChange={event => setDraft({ ...draft, [item.key]: event.target.checked })} /></label>)}
    </div><div className="notification-actions"><button className="credential-primary" disabled={busy || !dirty}>{msg('notificationSettings.saveSettings')}</button><button className="credential-secondary" type="button" disabled={busy} onClick={() => void run('reload')}>{msg('aiSettings.reload')}</button></div></form>}
    <div className="security-card"><div className="security-setting"><div><h2>{msg('notificationSettings.testSystemNotification')}</h2><p>{msg('notificationSettings.sendATestNotificationWithoutAssetInformationUsing')}</p></div><button className="credential-secondary" disabled={busy || !state?.supported} onClick={() => void run('test')}>{msg('notificationSettings.sendTestNotification')}</button></div></div>
    {state && !state.supported && <p className="drawer-error">{msg('notificationSettings.nativeNotificationsAreUnavailableOnThisSystemIn')}</p>}
    {state?.delivery === 'failed' && !message && <p className="drawer-error">{msg('notificationSettings.theLastSystemNotificationFailedCheckNotificationPermissions')}</p>}
    {!draft && <button className="credential-secondary" disabled={busy} onClick={() => void run('reload')}>{msg('notificationSettings.reloadSettings')}</button>}
    <p className="security-footnote">{msg('notificationSettings.notificationsContainOnlyApprovalCountsWithoutServersCommands')}</p>
  </section>
}
