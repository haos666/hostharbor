import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, LockKeyhole, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { AppStatus } from '../../../shared/contracts'
import { Dialog } from './Dialog'
import { McpLockSetting } from './McpLockSetting'
import { IdleLockSetting } from './IdleLockSetting'

type Mode = 'setup' | 'password' | 'reset' | 'recovery'
const titles: Record<Mode, string> = { get setup() { return msg('securitySettings.setLockPassword') }, get password() { return msg('securitySettings.changeLockPassword') }, get reset() { return msg('securitySettings.resetLockPassword') }, get recovery() { return msg('securitySettings.changeRecoveryCode') } }
const api = window.hostharbor
export function SecuritySettings({ status, onRefresh }: { status: AppStatus | null; onRefresh: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => { setMode(null) }, [status?.lockRevision])
  const configured = status?.security === 'password'
  return <section className="security-page">
    <header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('aiSettings.settings')}</span><h1>{msg('securitySettings.security')}</h1></div></header>
    {message && <div className="credential-notice" role="status"><ShieldCheck size={16} /><span>{message}</span><button aria-label={msg('agentWorkspace.dismissMessage')} onClick={() => setMessage('')}><X size={15} /></button></div>}
    <div className="security-card">
      <div className="security-setting"><span className="security-setting-icon"><LockKeyhole size={21} /></span><div><h2>{msg('securitySettings.lockPassword')}</h2><p>{configured ? msg('securitySettings.verifyYourPasswordWheneverUnlockingTheVault') : status?.security === 'legacy' ? msg('securitySettings.setAPasswordForTheExistingVaultTo') : msg('securitySettings.setAPasswordAndRecoveryCodeToCreate')}</p></div><button className="quiet-button" disabled={!status} onClick={() => setMode(configured ? 'password' : 'setup')}>{configured ? msg('securitySettings.changePassword') : msg('securitySettings.setPassword')}</button></div>
      {configured && <div className="security-setting"><span className="security-setting-icon"><KeyRound size={21} /></span><div><h2>{msg('securitySettings.recoveryCode')}</h2><p>{msg('securitySettings.resetAForgottenPasswordKeepTheCodeIn')}</p></div><button className="quiet-button" onClick={() => setMode('recovery')}>{msg('securitySettings.changeRecoveryCode')}</button></div>}
      <IdleLockSetting status={status} />
      <McpLockSetting status={status} />
    </div>
    <p className="security-footnote">{msg('securitySettings.ifBothPasswordAndRecoveryCodeAreLost')}</p>
    {configured && <button className="text-button" onClick={() => setMode('reset')}>{msg('securitySettings.forgotPasswordResetWithRecoveryCode')}</button>}
    {mode && <SecurityForm mode={mode} onClose={() => setMode(null)} onSaved={async () => { setMode(null); setMessage(mode === 'recovery' ? msg('securitySettings.recoveryCodeUpdatedTheOldCodeIsInvalid') : msg('securitySettings.securitySettingsUpdatedUnlockWithTheNewPassword')); await onRefresh() }} />}
  </section>
}

export function UnlockGate({ status, onRefresh, onSetup }: { status: AppStatus | null; onRefresh: () => Promise<void>; onSetup: () => void }) {
  const [mode, setMode] = useState<'unlock' | 'reset' | null>(null)
  useEffect(() => { setMode(null) }, [status?.lockRevision])
  const needsSetup = status?.security !== 'password'
  return <div className="vault-gate">
    <div className="vault-symbol"><LockKeyhole size={28} strokeWidth={1.5} /></div>
    <h2>{!status ? msg('securitySettings.connecting') : needsSetup ? msg('securitySettings.setVaultPassword') : status?.backgroundMcp ? msg('securitySettings.desktopLocked') : msg('securitySettings.vaultLocked')}</h2>
    <p>{needsSetup ? msg('securitySettings.setALockPasswordAndRecoveryCodeBefore') : msg('securitySettings.enterTheLockPasswordToViewAndManage')}</p>
    {status?.backgroundMcp && <p>{msg('securitySettings.authorizedMcpAccessMayContinueInTheBackground')}</p>}
    <button className="credential-primary" disabled={!status} onClick={() => needsSetup ? onSetup() : setMode('unlock')}>{needsSetup ? msg('securitySettings.goToSecuritySettings') : status?.backgroundMcp ? msg('securitySettings.unlockApp') : msg('securitySettings.unlockVault')}</button>
    {!needsSetup && <button className="text-button forgot-password" onClick={() => setMode('reset')}>{msg('securitySettings.forgotPassword')}</button>}
    {mode === 'unlock' && <UnlockForm onClose={() => setMode(null)} onSaved={async () => { setMode(null); await onRefresh() }} />}
    {mode === 'reset' && <SecurityForm mode="reset" onClose={() => setMode(null)} onSaved={async () => { setMode('unlock'); await onRefresh() }} />}
  </div>
}
function UnlockForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget
    const password = String(new FormData(form).get('password')); form.reset(); setBusy(true); setError('')
    try {
      const result = await api.unlockVault(password)
      if (!result.ok) { setError(errorText(result.error)); return }
      await onSaved()
    } catch { setError(msg('securitySettings.unlockIncompleteRetry')) }
    finally { setBusy(false) }
  }
  return <Dialog className="credential-confirm security-dialog" labelledBy="unlock-title" onDismiss={() => { if (!busy) onClose() }}><div className="unlock-heading"><span><LockKeyhole size={18} /></span><h2 id="unlock-title">{msg('securitySettings.unlockVault')}</h2></div><form onSubmit={(event) => void submit(event)}><label className="drawer-field">{msg('securitySettings.lockPassword')}<input name="password" type="password" placeholder={msg('securitySettings.enterLockPassword')} required autoComplete="current-password" autoFocus data-initial-focus disabled={busy} /></label>{error && <div className="drawer-error" role="alert">{error}</div>}<div className="confirm-actions"><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy}>{busy ? msg('securitySettings.unlocking') : msg('securitySettings.unlock')}</button></div></form></Dialog>
}

function SecurityForm({ mode, onClose, onSaved }: { mode: Mode; onClose: () => void; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [visibleRecovery, setVisibleRecovery] = useState(false)
  function dismiss() { if (!busy) { if (dirty) setDiscard(true); else onClose() } }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    const get = (name: string) => String(data.get(name) ?? '')
    if (mode !== 'recovery' && get('newPassword') !== get('confirmPassword')) { setError(msg('securitySettings.passwordsDoNotMatch')); return }
    if ((mode === 'setup' || mode === 'recovery') && get('newRecovery') !== get('confirmRecovery')) { setError(msg('securitySettings.recoveryCodesDoNotMatch')); return }
    setError(''); setBusy(true); form.reset(); setDirty(false); setVisibleRecovery(false)
    try {
      const result = mode === 'setup' ? await api.setupSecurity({ password: get('newPassword'), recovery: get('newRecovery') })
        : mode === 'password' ? await api.changePassword({ currentPassword: get('currentPassword'), newPassword: get('newPassword') })
        : mode === 'reset' ? await api.resetPassword({ recovery: get('currentRecovery'), newPassword: get('newPassword') })
        : await api.changeRecovery({ currentPassword: get('currentPassword'), currentRecovery: get('currentRecovery'), newRecovery: get('newRecovery') })
      if (!result.ok) { setError(errorText(result.error)); return }
      await onSaved()
    } catch { setError(msg('securitySettings.operationIncompleteEnterTheDetailsAgainAndRetry')) }
    finally { setBusy(false) }
  }
  function generate(form: HTMLFormElement | null) {
    if (!form) return
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    const field = form.elements.namedItem('newRecovery') as HTMLInputElement
    field.value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const confirmation = form.elements.namedItem('confirmRecovery') as HTMLInputElement
    confirmation.value = ''; bytes.fill(0); setDirty(true); setVisibleRecovery(true)
  }
  return <>
    <Dialog className="credential-drawer security-drawer" labelledBy="security-title" onDismiss={dismiss}><form autoComplete="off" onChange={() => setDirty(true)} onSubmit={(event) => void submit(event)}>
      <div className="drawer-heading"><div><span className="page-label">{msg('securitySettings.securitySettings')}</span><h2 id="security-title">{titles[mode]}</h2></div><button type="button" className="icon-button" disabled={busy} aria-label={msg('securitySettings.closeSecuritySettings')} onClick={dismiss}><X size={20} /></button></div>
      <div className="drawer-content">
        {(mode === 'password' || mode === 'recovery') && <label className="drawer-field">{msg('securitySettings.currentPassword')}<input name="currentPassword" type="password" required autoComplete="current-password" data-initial-focus disabled={busy} /></label>}
        {(mode === 'reset' || mode === 'recovery') && <label className="drawer-field">{mode === 'recovery' ? msg('securitySettings.currentRecoveryCode') : msg('securitySettings.recoveryCode')}<input name="currentRecovery" type="password" required data-initial-focus={mode === 'reset' ? true : undefined} disabled={busy} /></label>}
        {mode !== 'recovery' && <><label className="drawer-field">{mode === 'setup' ? msg('securitySettings.lockPassword') : msg('credentialsPage.newPassword')}<input name="newPassword" type="password" required autoComplete="new-password" data-initial-focus={mode === 'setup' ? true : undefined} disabled={busy} /></label><label className="drawer-field">{msg('securitySettings.confirmPassword')}<input name="confirmPassword" type="password" required autoComplete="new-password" disabled={busy} /></label></>}
        {(mode === 'setup' || mode === 'recovery') && <><div className="key-field-heading"><span>{mode === 'setup' ? msg('securitySettings.recoveryCode') : msg('securitySettings.newRecoveryCode')}</span><button type="button" className="text-button" disabled={busy} onClick={(event) => generate(event.currentTarget.form)}><RefreshCw size={12} /> {msg('securitySettings.generateRandomly')}</button></div><label className="drawer-field"><span className="sr-only">{msg('securitySettings.newRecoveryCode')}</span><input name="newRecovery" type={visibleRecovery ? 'text' : 'password'} required disabled={busy} /><button type="button" className="text-button recovery-visibility" disabled={busy} onClick={() => setVisibleRecovery(!visibleRecovery)}>{visibleRecovery ? msg('securitySettings.hideRecoveryCode') : msg('securitySettings.showRecoveryCode')}</button><small>{msg('securitySettings.chooseYourOwnOrGenerateOneItMust')}</small></label><label className="drawer-field">{msg('securitySettings.confirmRecoveryCode')}<input name="confirmRecovery" type="password" required disabled={busy} /></label><label className="security-checkbox"><input type="checkbox" required disabled={busy} />{msg('securitySettings.iSavedTheRecoveryCodeInAnotherSafe')}</label></>}
        <div className="security-warning">{mode === 'setup' ? msg('securitySettings.ifBothPasswordAndRecoveryCodeAreLost2') : mode === 'recovery' ? msg('securitySettings.theOldCodeBecomesInvalidSaveTheNew') : msg('securitySettings.savingLocksTheVaultUnlockWithTheNew')}</div>
        {error && <div className="drawer-error" role="alert">{error}</div>}
      </div><div className="drawer-bottom"><div><button type="button" className="quiet-button" disabled={busy} onClick={dismiss}>{msg('agentWorkspace.cancel')}</button><button className="credential-primary" disabled={busy}>{busy ? msg('agentWorkspace.saving') : msg('notificationSettings.saveSettings')}</button></div></div>
    </form></Dialog>
    {discard && <Dialog className="credential-confirm" labelledBy="security-discard" onDismiss={() => setDiscard(false)}><h2 id="security-discard">{msg('agentWorkspace.discardUnsavedChanges')}</h2><p>{msg('credentialsPage.thisInputWillNotBeSaved')}</p><div className="confirm-actions"><button className="quiet-button" data-initial-focus onClick={() => setDiscard(false)}>{msg('agentWorkspace.keepEditing')}</button><button className="destructive-button" onClick={onClose}>{msg('agentWorkspace.discardChanges')}</button></div></Dialog>}
  </>
}
