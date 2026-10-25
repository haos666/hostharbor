import { msg, errorText } from '../../../shared/i18n'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Check, RefreshCw } from 'lucide-react'
import type { AiModelList, AiProtocol, AiSettings as Config, AppStatus } from '../../../shared/contracts'
import type { Result } from '../../../shared/errors'
import { Dialog } from './Dialog'
import { UnlockGate } from './SecuritySettings'
const api = window.hostharbor
const defaults: Record<AiProtocol, string> = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' }
const labels = { openai: 'OpenAI', anthropic: 'Anthropic' }
function unwrap<T>(result: Result<T>): T { if (!result.ok) throw new Error(errorText(result.error)); return result.value }
export function AiSettings({ status, onRefresh, onSetup }: { status: AppStatus | null; onRefresh: () => Promise<void>; onSetup: () => void }) {
  const [config, setConfig] = useState<Config | null>(null), [provider, setProvider] = useState<AiProtocol>('openai')
  const [baseUrl, setBaseUrl] = useState(defaults.openai), [model, setModel] = useState(''), [models, setModels] = useState<AiModelList | null>(null)
  const [dirty, setDirty] = useState(false), [switchTo, setSwitchTo] = useState<AiProtocol | null>(null), [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const form = useRef<HTMLFormElement>(null), epoch = useRef(0), unlocked = status?.vault === 'unlocked'
  function clearKey() { const input = form.current?.elements.namedItem('apiKey') as HTMLInputElement | null; if (input) input.value = '' }
  function select(next: AiProtocol, current: Config) {
    epoch.current++; clearKey(); setProvider(next); setBaseUrl(current.providers[next]?.baseUrl ?? defaults[next]); setModel(current.providers[next]?.model ?? ''); setModels(null); setDirty(false); setError(''); setNotice(''); setSwitchTo(null)
  }
  useEffect(() => {
    const current = ++epoch.current; clearKey(); setConfig(null); setModels(null); setError(''); setNotice(''); setDirty(false); setSwitchTo(null); setRemoving(false)
    if (unlocked) void api.getAiSettings().then((r) => { if (current === epoch.current) { const result = unwrap(r); setConfig(result); select(result.activeProvider ?? 'openai', result) } }).catch((e: Error) => { if (current === epoch.current) setError(e.message) })
    return () => { epoch.current++; clearKey() }
  }, [unlocked, status?.lockRevision])
  async function reload() {
    const current = epoch.current; setError('')
    try { const result = unwrap(await api.getAiSettings()); if (current === epoch.current) { setConfig(result); select(provider, result) } }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('aiSettings.loadFailed')) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await run('save') }
  async function run(kind: 'save' | 'models' | 'remove') {
    if (!config || busy) return
    const current = epoch.current, key = String(new FormData(form.current!).get('apiKey') ?? '').trim()
    const input = { revision: config.revision, provider, baseUrl, ...(key ? { apiKey: key } : {}) }
    setBusy(true); setError(''); setNotice('')
    // Keep new input only in this form while selecting models; never put it in React state.
    if (kind !== 'models') clearKey()
    try {
      if (kind === 'models') {
        const result = unwrap(await api.listAiModels(input)); if (current !== epoch.current) return
        setModels(result); setNotice(result.models.length ? msg('aiSettings.connectedToTheModelListValueModelsValue', { value0: result.models.length, value1: result.truncated ? msg('aiSettings.readLimitReachedOtherModelIdsCanBe') : '' }) : msg('aiSettings.connectedButTheModelListIsEmptyEnter'))
      } else {
        const result = unwrap(kind === 'save' ? await api.saveAiProvider({ ...input, model }) : await api.removeAiProvider({ revision: config.revision, provider }))
        if (current !== epoch.current) return
        setConfig(result); select(provider, result); setRemoving(false); setNotice(kind === 'save' ? msg('aiSettings.aiSettingsSaved') : msg('aiSettings.configurationAndApiKeyForThisProtocolCleared'))
      }
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('agentWorkspace.operationFailed')) }
    finally { setBusy(false) }
  }
  async function probe() {
    if (!config || busy || dirty) return
    const current = epoch.current; setBusy(true); setError(''); setNotice('')
    try { unwrap(await api.testAiTools({ revision: config.revision })); if (current === epoch.current) setNotice(msg('aiSettings.modelCapabilityTestPassedTwoToolCallRounds')) }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : msg('aiSettings.testFailed')) }
    finally { setBusy(false) }
  }
  const saved = config?.providers[provider]
  return <section className="ai-settings"><header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('aiSettings.settings')}</span><h1>{msg('aiSettings.aiSettings')}</h1></div>{config?.activeProvider && <span className="ai-saved-provider"><Check size={14} />{msg('aiSettings.currentConfiguration')}{labels[config.activeProvider]}</span>}</header>
    {!unlocked ? <UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup} /> : !config ? <>{error && <p role="alert" className="drawer-error">{error}</p>}<button className="credential-secondary" onClick={() => void reload()}>{msg('aiSettings.reload')}</button></> : <>
      <div className="ai-protocols" role="group" aria-label={msg('aiSettings.aiApiProtocol')}>{(['openai', 'anthropic'] as const).map((p) => <button aria-pressed={provider === p} disabled={busy} key={p} onClick={() => { if (p !== provider) { if (dirty) setSwitchTo(p); else select(p, config) } }}><Bot size={18} /><strong>{labels[p]}</strong><span>{p === 'openai' ? msg('aiSettings.openaiAndCompatibleApis') : msg('aiSettings.anthropicAndCompatibleApis')}</span>{config.providers[p] && <small>{msg('agentWorkspace.saved')}</small>}</button>)}</div>
      <form ref={form} className="ai-config-form" onSubmit={(e) => void submit(e)} autoComplete="off">
        <fieldset disabled={busy}><label>{msg('aiSettings.apiAddress')}<input name="baseUrl" type="url" required maxLength={2048} value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setModels(null); setNotice(''); setDirty(true); clearKey() }} placeholder={defaults[provider]} /><small>{msg('aiSettings.enterTheApiBaseUrlSuchAsV1')}</small></label>
        <label>API Key<input name="apiKey" type="password" maxLength={8192} autoComplete="new-password" placeholder={saved?.hasKey ? msg('aiSettings.savedLeaveBlankToKeepEnterAgainWhen') : msg('aiSettings.enterApiKey')} onChange={() => { setDirty(true); setModels(null); setNotice('') }} /><small>{saved?.hasKey ? msg('aiSettings.savedKeysAreNeverDisplayed') : msg('aiSettings.keysAreEncryptedInTheLocalVault')}{msg('aiSettings.newInputStaysOnlyInThisFormAnd')}</small></label>
        <div className="ai-model-heading"><span>{msg('aiSettings.model')}</span><button type="button" className="credential-secondary" disabled={busy} onClick={() => void run('models')}><RefreshCw size={14} />{busy ? msg('aiSettings.processing') : msg('aiSettings.getModelsTestConnection')}</button></div>
        <label><span className="sr-only">{msg('aiSettings.modelId')}</span><input name="model" list="ai-model-options" required maxLength={256} value={model} onChange={(e) => { setModel(e.target.value); setDirty(true) }} placeholder={msg('aiSettings.selectAFetchedModelOrEnterItsId')} /><datalist id="ai-model-options">{models?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist><small>{msg('aiSettings.enterAModelIdManuallyIfTheCompatible')}</small></label></fieldset>
        {notice && <p className="credential-notice" role="status">{notice}</p>}{error && <div className="drawer-error" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={() => void reload()}>{msg('aiSettings.reloadSavedConfiguration')}</button></div>}
        <div className="ai-form-actions">{saved && <button type="button" className="text-button" disabled={busy} onClick={() => { setError(''); setRemoving(true) }}>{msg('aiSettings.clearThisProtocolConfiguration')}</button>}<button className="credential-primary" disabled={busy}>{busy ? msg('aiSettings.processing') : msg('aiSettings.saveConfiguration')}</button></div>
      </form>{config.activeProvider === provider && saved && <div className="ai-probe"><button type="button" className="credential-secondary" disabled={busy || dirty} onClick={() => void probe()}><Bot size={14} />{busy ? msg('aiSettings.testing') : msg('aiSettings.testModelCapabilities')}</button><small>{msg('aiSettings.useSavedSettingsAndFixedSyntheticDataTo')}{dirty && msg('aiSettings.saveChangesFirst')}</small></div>}<p className="security-footnote">{msg('aiSettings.fetchingModelsSendsTheApiKeyOnlyTo')}</p>
      {switchTo && <Dialog className="credential-confirm" labelledBy="ai-discard" onDismiss={() => setSwitchTo(null)}><h2 id="ai-discard">{msg('aiSettings.switchProtocolAndDiscardUnsavedInput')}</h2><p>{msg('aiSettings.savedConfigurationsRemainSeparateForEachProtocolThe')}</p><div className="confirm-actions"><button className="credential-secondary" onClick={() => setSwitchTo(null)}>{msg('agentWorkspace.keepEditing')}</button><button className="credential-primary" onClick={() => select(switchTo, config)}>{msg('aiSettings.switchProtocol')}</button></div></Dialog>}
      {removing && <Dialog className="credential-confirm" labelledBy="ai-remove" onDismiss={() => { if (!busy) setRemoving(false) }}><h2 id="ai-remove">{msg('aiSettings.clear')} {labels[provider]} {msg('aiSettings.configuration')}</h2><p>{msg('aiSettings.deleteTheSavedAddressModelAndApiKey')}</p>{error && <p className="drawer-error" role="alert">{error}</p>}<div className="confirm-actions"><button className="credential-secondary" disabled={busy} onClick={() => setRemoving(false)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" disabled={busy} onClick={() => void run('remove')}>{msg('aiSettings.confirmClearing')}</button></div></Dialog>}
    </>}
  </section>
}
