import { msg, type MessageKey } from '../../shared/i18n'
import chinese from '../../shared/locales/zh-CN.json'
import { toolGuides as originalGuides, toolGroups as originalGroups } from '../../shared/mcp-tools'
import { riskPresets as originalRisks } from '../../shared/risk-presets'
import { systemFields as originalFields } from '../../shared/dossier'
import { operationApproval as originalApproval } from '../../shared/operation-approval'

const keys = Object.fromEntries(Object.entries(chinese).map(([key, text]) => [text, key]))
function staticText(text: string): string {
  const key = (keys as Record<string, string>)[text]
  return key ? msg(key as MessageKey) : text
}
function catalog<Value>(value: Value): Value {
  if (value && typeof value === 'object') {
    const target = (Array.isArray(value) ? [] : {}) as Record<string, unknown>
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') Object.defineProperty(target, key, { enumerable: true, get: () => staticText(item) })
      else target[key] = catalog(item)
    }
    return target as Value
  }
  return value
}
export const toolGuides = catalog(originalGuides)
export const toolGroups = catalog(originalGroups)
export const riskPresets = catalog(originalRisks)
export const systemFields = catalog(originalFields)
export function operationApproval(...args: Parameters<typeof originalApproval>): ReturnType<typeof originalApproval> {
  const result = originalApproval(...args)
  return { ...result, label: staticText(result.label) }
}
