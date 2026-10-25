import chinese from './locales/zh-CN.json'
import errorKeys from './locales/error-keys.json'
import type { ErrorCode } from './errors'
import configuredLanguages from './locales/languages.json'

export const languages = configuredLanguages
export type Locale = keyof typeof languages
export type LanguagePreference = Locale | 'system'
export interface LanguageSettings { preference: LanguagePreference; locale: Locale }
export type MessageKey = keyof typeof chinese
const files = import.meta.glob<Record<string, string>>('./locales/*.json', { eager: true, import: 'default' })
const resources = Object.fromEntries(Object.keys(languages).map(language => [language, files[`./locales/${language}.json`]])) as Record<Locale, Record<MessageKey, string>>
let locale: Locale = 'zh-CN'
const listeners = new Set<() => void>()
export function isLocale(value: unknown): value is Locale { return typeof value === 'string' && Object.hasOwn(languages, value) }
export function isLanguagePreference(value: unknown): value is LanguagePreference { return value === 'system' || isLocale(value) }
export function resolveLanguage(preference: LanguagePreference, systemLanguages: readonly string[]): Locale {
  if (preference !== 'system') return preference
  const supported = Object.keys(languages) as Locale[]
  for (const systemLanguage of systemLanguages) {
    const normalized = systemLanguage.replaceAll('_', '-').toLowerCase()
    const exact = supported.find(language => language.toLowerCase() === normalized)
    if (exact) return exact
    const related = supported.find(language => language.toLowerCase().split('-')[0] === normalized.split('-')[0])
    if (related) return related
  }
  return 'en'
}
export function getLocale(): Locale { return locale }
export function setLocale(value: Locale): void {
  if (!isLocale(value) || value === locale) return
  locale = value
  for (const listener of listeners) listener()
}
export function subscribeLocale(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function msg(key: MessageKey, values: Record<string, string | number | undefined> = {}): string {
  return (resources[locale]?.[key] ?? chinese[key]).replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(values, name) ? typeof values[name] === 'number' ? new Intl.NumberFormat(locale).format(values[name]) : values[name] ?? '—' : placeholder)
}
export function errorText(error: { code: string }): string {
  return msg((Object.hasOwn(errorKeys, error.code) ? errorKeys[error.code as ErrorCode] : errorKeys.INTERNAL) as MessageKey)
}
export const localizedErrors = {} as Record<ErrorCode, string>
for (const [code, key] of Object.entries(errorKeys)) Object.defineProperty(localizedErrors, code, { get: () => msg(key as MessageKey) })
