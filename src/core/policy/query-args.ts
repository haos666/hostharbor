import { posix } from 'node:path'
export interface QueryRecipe { command: string; kind: string; label?: boolean; notice?: string; scopeUsed?: boolean }
export interface QueryScope { cwd?: string; hosts?: string[]; logFiles?: string[]; revision?: string }
export class QueryCommandError extends Error {}
export const fail = (reason: string): never => { throw new QueryCommandError(reason) }
export type ValueCheck = (value: string) => boolean
export type Spec = Record<string, true | ValueCheck>
export const number: ValueCheck = s => /^\d{1,4}$/.test(s) && Number(s) >= 1 && Number(s) <= 2000
export const unit: ValueCheck = s => /^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,127}$/.test(s)
export const text: ValueCheck = s => s.length > 0 && s.length <= 512 && !/[\x00-\x1f\x7f]/.test(s)
export const oneOf = (...values: string[]): ValueCheck => s => values.includes(s)
export const flags = (...names: string[]): Spec => Object.fromEntries(names.map(name => [name, true]))
export function resolveQueryPath(value: string, scope: QueryScope = {}): string | undefined {
  if (!value || value === '-' || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return
  const cwd = scope.cwd ?? '/'
  if (!cwd.startsWith('/')) return
  return posix.resolve(cwd, value)
}
export function metadataPath(value: string, scope: QueryScope = {}): boolean {
  const resolved = resolveQueryPath(value, scope)
  return !!resolved && directory(resolved)
}
// Metadata tools may name any literal absolute path; contents use a separate scope.
export const directory: ValueCheck = path => path.length <= 1024 && /^\/(?:[A-Za-z0-9_.@+-]+\/?)*$/.test(path) && !path.slice(1).split('/').some(p => p === '.' || p === '..') && !path.includes('//')
export function certificate(path: string, _scope?: QueryScope): boolean {
  path = resolveQueryPath(path, _scope) ?? ''
  if (/(?:^|[\/._-])(?:privkey|private|key)(?:$|[\/._-])/i.test(path)) return false
  return directory(path) && ((/^\/(?:etc|opt|srv|data|usr\/local|var)\//.test(path) && /\.(?:crt|cer|pem)$/.test(path))
    || /^\/root\/\.acme\.sh\/[^/]+\/[^/]+\.cer$/.test(path))
}
// A positive read namespace, not an assurance about remote symlinks/file contents.
// Application-specific paths use the maintained, version-bound log query tool.
export function queryFile(path: string, scope: QueryScope = {}): boolean {
  path = resolveQueryPath(path, scope) ?? ''
  if (path.length > 1024 || !path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) return false
  const parts = path.slice(1).split('/')
  if (parts.some(p => !p || p === '.' || p === '..')) return false
  if (['/etc/os-release', '/etc/issue', '/proc/meminfo', '/proc/cpuinfo', '/proc/loadavg', '/proc/uptime', '/proc/version', '/proc/mounts', '/proc/diskstats', '/proc/net/dev', '/proc/net/route', '/proc/net/sockstat', '/proc/stat', '/proc/swaps', '/etc/hostname', '/etc/hosts', '/etc/resolv.conf'].includes(path)) return true
  if (/(?:^|[/.\-_])(?:shadow|passwd|passwords?|passphrase|secrets?|tokens?|credentials?|private|id_rsa|id_ed25519)(?:$|[/.\-_])/i.test(path) || /\/(?:\.ssh|\.aws)\//.test(path) || /\/(?:\.env)(?:$|[./_-])/i.test(path) || /\.(?:key|pem|p12|pfx|env)(?:$|[._-])/i.test(path)) return false
  if (scope.logFiles?.includes(path)) return true
  if (!/^\/[A-Za-z0-9_./-]+$/.test(path)) return false
  if (path === '/root/.acme.sh/acme.sh.log') return true
  const namespace = path.startsWith('/var/log/') || (/^\/(?:opt|srv|data|usr\/local|var\/www)\//.test(path) && /\/(?:logs?|logfiles)\//i.test(path))
  return namespace && (/(?:\.(?:log|out)(?:\.\d+)?|\/(?:access_log|error_log|messages|syslog|secure|dmesg|boot\.log))$/.test(path))
}
export function options(args: string[], spec: Spec, validOperand: ValueCheck = () => false, maxOperands = 0): { args: string[]; operands: string[]; used: Set<string>; entries: { name: string; value?: string }[] } {
  const normalized: string[] = [], operands: string[] = [], used = new Set<string>(), entries: { name: string; value?: string }[] = []; let ended = false
  const valueOption = (name: string, value: string) => {
    used.add(name); entries.push({ name, value })
    // GNU optional long arguments require '='; date -I requires attachment.
    if (name.startsWith('--')) normalized.push(`${name}=${value}`)
    else if (name === '-I') normalized.push(name + value)
    else normalized.push(name, value)
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--' && !ended) { ended = true; normalized.push(arg); continue }
    if (!ended && arg.startsWith('-') && arg !== '-') {
      const equal = arg.startsWith('--') ? arg.indexOf('=') : -1
      const name = equal > 0 ? arg.slice(0, equal) : arg
      const rule = Object.hasOwn(spec, name) ? spec[name] : undefined
      if (rule === true && equal < 0) { used.add(name); entries.push({ name }); normalized.push(name); continue }
      if (typeof rule === 'function') {
        const value = equal > 0 ? arg.slice(equal + 1) : args[++i]
        if (value === undefined || !rule(value)) fail('查询参数值超出支持范围')
        valueOption(name, value); continue
      }
      if (/^-[A-Za-z].+/.test(arg)) {
        for (let letter = 1; letter < arg.length; letter++) {
          const key = `-${arg[letter]}`, check = Object.hasOwn(spec, key) ? spec[key] : undefined
          if (check === true) { used.add(key); entries.push({ name: key }); normalized.push(key) }
          else if (typeof check === 'function') {
            const value = arg.slice(letter + 1) || args[++i]
            if (value === undefined || !check(value)) fail('查询参数值超出支持范围')
            valueOption(key, value); break
          } else fail('包含未支持或可能改变行为的命令参数')
        }
        continue
      }
      fail('包含未支持或可能改变行为的命令参数')
    }
    if (operands.length >= maxOperands || !validOperand(arg)) fail('查询对象、文件路径或位置参数不在支持范围')
    operands.push(arg); normalized.push(arg)
  }
  return { args: normalized, operands, used, entries }
}
