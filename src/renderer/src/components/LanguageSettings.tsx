import { useEffect, useState } from 'react'
import { errorText, isLanguagePreference, languages, msg, setLocale, type LanguagePreference } from '../../../shared/i18n'

export function LanguageSettings() {
  const [preference, setPreference] = useState<LanguagePreference>('system')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    const unsubscribe = window.hostharbor.onLanguageChanged(settings => { setPreference(settings.preference); setLocale(settings.locale) })
    void window.hostharbor.getLanguage().then(result => { if (disposed) return; if (!result.ok) setError(result.error.code); else { setPreference(result.value.preference); setLocale(result.value.locale) } }).catch(() => { if (!disposed) setError('STORAGE_FAILED') }).finally(() => { if (!disposed) setLoaded(true) })
    return () => { disposed = true; unsubscribe() }
  }, [])
  async function save(value: string) {
    if (!isLanguagePreference(value) || busy) return
    setBusy(true); setError('')
    try {
      const result = await window.hostharbor.saveLanguage(value)
      if (!result.ok) { setError(result.error.code); return }
      setPreference(result.value.preference); setLocale(result.value.locale)
    } catch { setError('STORAGE_FAILED') }
    finally { setBusy(false) }
  }
  return <section><header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('aiSettings.settings')}</span><h1>{msg('language.title')}</h1></div></header>
    <div className="security-card"><label className="security-setting language-setting"><div><h2>{msg('language.title')}</h2><p>{msg('language.interfaceLanguage')}</p></div><select aria-label={msg('language.title')} value={preference} disabled={busy || !loaded} onChange={event => void save(event.target.value)}><option value="system">{msg('language.followSystem')}</option>{Object.entries(languages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {error && <p className="drawer-error" role="alert">{errorText({ code: error })}</p>}
  </section>
}
