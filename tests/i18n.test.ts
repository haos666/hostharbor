import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorText, getLocale, isLocale, languages, localizedErrors, msg, resolveLanguage, setLocale, subscribeLocale, type Locale } from '../src/shared/i18n'
import chinese from '../src/shared/locales/zh-CN.json'
import { messages } from '../src/shared/errors'
import { toolGuides, toolGroups, riskPresets, systemFields, operationApproval } from '../src/renderer/src/catalog'
import { toolGuides as protocolGuides, toolGroups as protocolGroups } from '../src/shared/mcp-tools'
import { LanguageSettingsStore } from '../src/main/language-settings'

const directories: string[] = []
afterEach(() => { setLocale('zh-CN'); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function directory() { const value = mkdtempSync(join(tmpdir(), 'hostharbor-i18n-test-')); directories.push(value); return value }
describe('language resources and display boundaries', () => {
  it('has complete keys, nonempty translations and matching interpolation variables for every registered language', () => {
    const files = import.meta.glob<Record<string, string>>('../src/shared/locales/*.json', { eager: true, import: 'default' })
    const variables = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    for (const locale of Object.keys(languages)) {
      const resource = files[`../src/shared/locales/${locale}.json`]
      expect(Object.keys(resource).sort()).toEqual(Object.keys(chinese).sort())
      for (const [key, value] of Object.entries(resource)) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('')
        expect(variables(value), `${locale}: ${key}`).toEqual(variables(chinese[key as keyof typeof chinese]))
        if (locale === 'en') expect(value, key).not.toMatch(/[\u3400-\u9fff]/u)
      }
    }
  })
  it('changes static catalogs immediately without translating protocol content or example values', () => {
    const original = JSON.stringify(protocolGuides), groups = JSON.stringify(protocolGroups)
    expect(toolGroups[0].label).toBe('文件与传输')
    setLocale('en')
    expect(toolGroups[0].label).toBe('Files and transfers')
    expect(toolGuides.start_command.title).toBe('Submit command')
    expect(toolGuides.start_command.notes[0]).not.toMatch(/[\u3400-\u9fff]/u)
    expect(JSON.stringify(toolGuides)).not.toMatch(/[\u3400-\u9fff]/u)
    expect(toolGuides.start_command.example).toEqual(protocolGuides.start_command.example)
    expect(riskPresets[0].name).toBe('File deletion')
    expect(systemFields[0].label).toBe('Operating system')
    expect(operationApproval({ state: 'unknown', decision: undefined, humanDecision: undefined }).label).toBe('Not recorded')
    expect(JSON.stringify(protocolGuides)).toBe(original)
    expect(JSON.stringify(protocolGroups)).toBe(groups)
    setLocale('zh-CN')
    expect(toolGuides.start_command.title).toBe('提交命令')
  })
  it('maps stable source error codes, including hostile and unknown codes, in the display language', () => {
    const original = { ...messages }
    for (const locale of Object.keys(languages) as Locale[]) {
      setLocale(locale)
      for (const code of Object.keys(messages) as (keyof typeof messages)[]) {
        expect(errorText({ code })).toBe(localizedErrors[code])
        if (locale === 'en') expect(errorText({ code })).not.toMatch(/[\u3400-\u9fff]/u)
      }
      expect(errorText({ code: 'constructor' })).toBe(localizedErrors.INTERNAL)
      expect(errorText({ code: '__proto__' })).toBe(localizedErrors.INTERNAL)
      expect(errorText({ code: 'FUTURE_CODE' })).toBe(localizedErrors.INTERNAL)
    }
    expect(messages).toEqual(original)
  })
  it('interpolates untrusted values as plain text and preserves explicit example placeholders', () => {
    setLocale('en')
    expect(msg('applicationsPanel.editValue', { value0: '<synthetic-user-value>' })).toBe('Edit <synthetic-user-value>')
    expect(toolGuides.list_servers.notes[2]).toContain('{serverName}')
    expect(msg('main.valuePendingApprovals', { value0: 1234 })).toBe('1,234 pending approvals')
  })
  it('notifies subscribers only for a valid changed language', () => {
    const values: string[] = [], unsubscribe = subscribeLocale(() => values.push(getLocale()))
    expect(isLocale('constructor')).toBe(false)
    setLocale('en'); setLocale('en'); setLocale('invalid' as Locale); unsubscribe(); setLocale('zh-CN')
    expect(values).toEqual(['en'])
  })
})
describe('nonsecret language preference', () => {
  it('defaults to following the system and retains explicit selections without any vault dependency', () => {
    const location = directory(), store = new LanguageSettingsStore(location)
    expect(store.get()).toBe('system')
    expect(store.save('en')).toBe('en')
    expect(new LanguageSettingsStore(location).get()).toBe('en')
    expect(JSON.parse(readFileSync(join(location, 'language-settings.json'), 'utf8'))).toEqual({ locale: 'en' })
  })
  it('matches system preferences in order, including regional variants and unsupported language fallback', () => {
    expect(resolveLanguage('system', ['zh-CN', 'en-US'])).toBe('zh-CN')
    expect(resolveLanguage('system', ['en-GB', 'zh-CN'])).toBe('en')
    expect(resolveLanguage('system', ['fr-FR', 'zh_TW'])).toBe('zh-CN')
    expect(resolveLanguage('system', ['de-DE'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
    expect(resolveLanguage('zh-CN', ['en-US'])).toBe('zh-CN')
    expect(resolveLanguage('en', ['zh-CN'])).toBe('en')
  })
  it('keeps legacy saved language selections and persists the system choice instead of its resolved language', () => {
    const location = directory(), file = join(location, 'language-settings.json')
    writeFileSync(file, JSON.stringify({ locale: 'zh-CN' }))
    const store = new LanguageSettingsStore(location)
    expect(store.get()).toBe('zh-CN')
    store.save('system')
    expect(new LanguageSettingsStore(location).get()).toBe('system')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ locale: 'system' })
    expect(resolveLanguage(store.get(), ['en-US'])).toBe('en')
    expect(resolveLanguage(store.get(), ['zh-CN'])).toBe('zh-CN')
  })
  it('rejects invalid writes and reports corrupt or oversized files without overwriting them', () => {
    const location = directory(), store = new LanguageSettingsStore(location), file = join(location, 'language-settings.json')
    store.save('en')
    for (const invalid of [null, {}, 'constructor', 'unknown', { locale: 'en' }]) expect(() => store.save(invalid)).toThrow()
    expect(store.get()).toBe('en')
    for (const corrupt of ['{', '{"locale":"invalid"}', '{"locale":"en","unexpected":true}', ' '.repeat(1025)]) {
      writeFileSync(file, corrupt)
      expect(() => store.get()).toThrow()
      expect(readFileSync(file, 'utf8')).toBe(corrupt)
    }
    store.save('zh-CN')
    expect(store.get()).toBe('zh-CN')
  })
})
