import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { AppStatus, IdleLockSettings } from '../../../shared/contracts'
import type { Result } from '../../../shared/errors'
const api = window.hostharbor
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(errorText(result.error)); return result.value }
export function IdleLockSetting({ status }: { status: AppStatus | null }) {
  const [settings, setSettings] = useState<IdleLockSettings | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  const epoch = useRef(0), unlocked = status?.vault === 'unlocked'
  async function load(current = epoch.current) {
    setBusy(true); setSettings(null); setError(''); setSaved(false)
    try { const next = unwrap(await api.getIdleLockSettings()); if (current === epoch.current) setSettings(next) }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('idleLockSetting.cannotLoadIdleLockSettings')) }
    finally { if (current === epoch.current) setBusy(false) }
  }
  useEffect(() => {
    const current = ++epoch.current
    setSettings(null); setError(''); setSaved(false); setBusy(false)
    void load(current)
    return () => { epoch.current++ }
  }, [status?.lockRevision, unlocked])
  async function change(value: string) {
    if (!settings || busy || !unlocked) return
    const current = epoch.current
    setBusy(true); setError(''); setSaved(false)
    try {
      const next = unwrap(await api.saveIdleLockSettings({ ...settings, seconds: value === 'off' ? null : Number(value) as 30 | 1800 }))
      if (current === epoch.current) { setSettings(next); setSaved(true) }
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('approvalSettings.saveFailed')) }
    finally { if (current === epoch.current) setBusy(false) }
  }
  return <div className="security-setting idle-lock-setting"><span className="security-setting-icon"><ShieldCheck size={21} /></span><div><h2>{msg('idleLockSetting.idleAutoLock')}</h2><p>{msg('idleLockSetting.lockAfterTheConfiguredPeriodWithoutKeyboardOr')}</p><p>{msg('idleLockSetting.disablingAffectsOnlyTheIdleTimerScreenLocking')}</p>{!unlocked && <small>{msg('idleLockSetting.unlockTheVaultToChangeThisSetting')}</small>}{error && <><p className="drawer-error" role="alert">{error}</p><button className="text-button" disabled={busy} onClick={() => void load()}>{msg('aiSettings.reload')}</button></>}{saved && <small role="status">{msg('agentWorkspace.saved')}</small>}</div><select aria-label={msg('idleLockSetting.idleAutoLockDuration')} disabled={!settings || !unlocked || busy} value={settings ? settings.seconds === null ? 'off' : String(settings.seconds) : ''} onChange={e => void change(e.target.value)}>{!settings && <option value="">{error ? msg('aiSettings.loadFailed') : msg('idleLockSetting.loading')}</option>}<option value="30">{msg('idleLockSetting.30Seconds')}</option><option value="1800">{msg('idleLockSetting.30Minutes')}</option><option value="off">{msg('common.off')}</option></select></div>
}
