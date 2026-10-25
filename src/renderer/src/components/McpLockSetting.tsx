import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { AppStatus, McpLockSettings } from '../../../shared/contracts'
import { Dialog } from './Dialog'

export function McpLockSetting({ status }: { status: AppStatus | null }) {
  const [settings, setSettings] = useState<McpLockSettings | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false)
  const epoch = useRef(0), unlocked = status?.vault === 'unlocked'
  useEffect(() => {
    const current = ++epoch.current
    setSettings(null); setConfirm(false); setBusy(false); setError('')
    void window.hostharbor.getMcpLockSettings().then(result => {
      if (current !== epoch.current) return
      if (result.ok) setSettings(result.value); else setError(errorText(result.error))
    }).catch(() => { if (current === epoch.current) setError(msg('mcpLockSetting.cannotLoadLockSettingsReopenSecuritySettings')) })
    return () => { epoch.current++ }
  }, [status?.lockRevision, unlocked])
  async function save(pauseMcp: boolean) {
    if (!settings || busy || !unlocked) return
    const current = epoch.current
    setBusy(true); setError('')
    try {
      const result = await window.hostharbor.saveMcpLockSettings({ ...settings, pauseMcp, confirmed: !pauseMcp })
      if (current !== epoch.current) return
      if (result.ok) { setSettings(result.value); setConfirm(false) } else setError(errorText(result.error))
    } catch { if (current === epoch.current) setError(msg('mcpLockSetting.saveFailedRetry')) }
    finally { if (current === epoch.current) setBusy(false) }
  }
  return <><div className="security-setting idle-lock-setting"><span className="security-setting-icon"><ShieldCheck size={21} /></span><div><h2>{msg('mcpLockSetting.pauseMcpAccessWhenLocked')}</h2><p>{msg('mcpLockSetting.whenEnabledLockingPausesMcpAccessWhenDisabled')}</p><p>{msg('mcpLockSetting.manualApprovalStillRequiresUnlockingAfterRestartUnlock')}</p>{!unlocked && <small>{msg('mcpLockSetting.unlockToChangeThisSetting')}</small>}{error && <p role="alert" className="drawer-error">{error}</p>}</div><input type="checkbox" role="switch" aria-label={msg('mcpLockSetting.pauseMcpAccessWhenLocked')} checked={settings?.pauseMcp ?? true} disabled={!settings || !unlocked || busy} onChange={e => e.target.checked ? void save(true) : setConfirm(true)} /></div>
    {confirm && unlocked && <Dialog className="credential-confirm" labelledBy="mcp-background-title" onDismiss={() => { if (!busy) setConfirm(false) }}><h2 id="mcp-background-title">{msg('mcpLockSetting.allowAccessWhileLocked')}</h2><p>{msg('mcpLockSetting.disablingAllowsAgentsToKeepUsingSavedCredentials')}</p><p>{msg('mcpLockSetting.theBackgroundCoreRetainsKeysNeededToUse')}</p>{error && <p role="alert" className="drawer-error">{error}</p>}<div className="confirm-actions"><button className="quiet-button" data-initial-focus disabled={busy} onClick={() => setConfirm(false)}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy} onClick={() => void save(false)}>{busy ? msg('agentWorkspace.saving') : msg('mcpLockSetting.allowBackgroundAccess')}</button></div></Dialog>}
  </>
}
