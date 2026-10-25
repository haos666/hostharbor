import { describe, expect, it } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnosticQueries, manualDiagnostics } from './helpers/diagnostic-cases'
import { analyzeQuery, queryPlan } from '../src/core/policy/queries'
import { evaluatePolicy } from '../src/core/policy/service'
import type { ApprovalPolicy } from '../src/shared/contracts'
const scope = { cwd: '/data/synthetic-proxy', hosts: ['synthetic.example.invalid'], logFiles: ['/custom/synthetic/runtime.trace', '/custom/synthetic/runtime trace'], revision: 'synthetic-revision' }
const policy: ApprovalPolicy = { revision: 1, mode: 'assisted', rules: [], aiAssist: false }
const input = { profileId: 'synthetic-profile', serverId: 'synthetic-server', cwd: scope.cwd, queryScope: scope }
describe('common diagnostic contract matrix', () => {
  it.each(diagnosticQueries)('%s: auto-authorizes registered diagnostic %s', (_category, command) => {
    const decision = evaluatePolicy(policy, { ...input, command })
    expect(decision.action, decision.reason).toBe('allow')
    expect(decision.queryPlan).toBeDefined()
    expect(decision.aiReview).toBeUndefined()
    if (process.platform !== 'win32') execFileSync('/bin/sh', ['-n', '-c', decision.queryPlan!.command])
  })
  it.each(manualDiagnostics)('keeps unsupported effects/manual boundaries: %s', command => {
    expect(evaluatePolicy(policy, { ...input, command }).action).not.toBe('allow')
    expect(queryPlan(command, scope)).toBeUndefined()
  })
  it.each(diagnosticQueries)('does not partially allow %s when a mutation is appended', (_category, command) => {
    for (const connector of [';', '&&', '||', '|']) {
      const result = analyzeQuery(`${command} ${connector} systemctl restart synthetic.service`, scope)
      expect(result.plan).toBeUndefined()
    }
  })
  it('binds maintained files to the context revision and respects relative cwd', () => {
    expect(queryPlan('tail -10 /custom/synthetic/runtime.trace', scope)?.scopeRevision).toBe('synthetic-revision')
    expect(queryPlan('tail -10 runtime.trace', { ...scope, cwd: '/custom/synthetic' })?.scopeRevision).toBe('synthetic-revision')
    expect(queryPlan('tail -10 runtime.trace', { ...scope, cwd: '/unregistered' })).toBeUndefined()
    expect(queryPlan('tail -10 /custom/synthetic/runtime.trace')).toBeUndefined()
    expect(queryPlan('tail -10 /custom/synthetic/runtime.trace', { ...scope, logFiles: [] })).toBeUndefined()
    expect(queryPlan('cat ../../etc/shadow', { cwd: '/data/synthetic' })).toBeUndefined()
  })
  it('preserves redirection ordering and validates both sides of fallback branches', () => {
    expect(queryPlan('uname -a 2>&1 >/dev/null')?.command).toContain('2>&1 >/dev/null')
    expect(queryPlan('uname -a >/dev/null 2>&1')?.command).toContain('>/dev/null 2>&1')
    expect(queryPlan('uname -a || echo unavailable')).toBeDefined()
    expect(queryPlan('uname -a || node -e "process.exit()"')).toBeUndefined()
  })
  it('retains literal data even when it resembles curl option syntax', () => {
    const plan = queryPlan("curl -I -w '--url=http://127.0.0.1/' http://127.0.0.1/")!
    expect(plan.command).toContain("'-w' '--url=http://127.0.0.1/'")
    expect(plan.command).toContain("'-q'")
    expect(queryPlan('curl -I --url=http://127.0.0.1/')?.command).toContain("'--max-redirs' '0'")
    expect(queryPlan('curl -m2 --connect-timeout=1 http://127.0.0.1/')?.command).toContain("'--max-time' '2'")
  })
  it('places enforced flags before option terminators', () => {
    expect(queryPlan('systemctl status -- synthetic.service')?.command).toContain('status --no-pager -- synthetic.service')
    expect(queryPlan('journalctl -u synthetic.service --')?.command).toContain('--no-pager -n 200 -u synthetic.service --')
    expect(queryPlan('openssl x509 -in /etc/ssl/certs/synthetic.pem -dates --')?.command).toContain('x509 -noout -in')
  })
  it('executes the rebuilt curl recipe against a disposable loopback server without body/config/credential forwarding', async () => {
    if (process.platform === 'win32') return
    const requests: { method?: string; url?: string; auth?: string; cookie?: string }[] = []
    const server = createServer((req, res) => { requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, cookie: req.headers.cookie }); res.setHeader('X-Synthetic', 'diagnostic'); res.end('synthetic health') })
    const directory = mkdtempSync(join(tmpdir(), 'hh-curl-diagnostic-'))
    writeFileSync(join(directory, '.curlrc'), 'header = "Authorization: synthetic-config-header"\n', { mode: 0o600 })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address')
      const plan = queryPlan(`curl -sI http://127.0.0.1:${address.port}/health`)!
      const result = await promisify(execFile)('/bin/sh', ['-c', plan.command], { env: { ...process.env, CURL_HOME: directory, http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '' } })
      expect(result.stdout).toContain('X-Synthetic: diagnostic')
      expect(requests).toEqual([{ method: 'HEAD', url: '/health', auth: undefined, cookie: undefined }])
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
  })
})
