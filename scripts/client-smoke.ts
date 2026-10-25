import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { ApplicationService } from '../src/core/applications/service'
import { InvestigationService } from '../src/core/investigation/service'
import { AiService } from '../src/core/ai/service'
import { LocalMcpServer } from '../src/core/mcp/server'
import { Store } from '../src/core/storage/database'
import { sshFixture, socksFixture } from '../tests/helpers/routes'
// Optional manual smoke: requires installed Codex, Claude Code and a POSIX test host.
// Never starts a model turn, loads production assets, or changes existing client configuration.
async function main() {
const directory = mkdtempSync(join(tmpdir(), 'hostharbor-clients-'))
const children: ReturnType<typeof spawn>[] = []
let servers!: ServerService, operations!: OperationService, mcp!: LocalMcpServer, ai!: AiService, investigations!: InvestigationService
let remote!: Awaited<ReturnType<typeof sshFixture>>, proxy!: Awaited<ReturnType<typeof socksFixture>>
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  assert.notEqual(process.platform, 'win32', 'This optional fixture needs a POSIX test host')
  for (const client of ['codex', 'claude']) { const version = spawnSync(client, ['--version'], { encoding: 'utf8' }); assert.equal(version.status, 0, `${client} must already be installed`); console.log('Client version:', version.stdout.trim()) }
  remote = await sshFixture({ exec: (command, stream) => {
    // Only this isolated SSH fixture executes the protocol's quoted POSIX wrapper.
    const child = spawn('/bin/sh', ['-c', command], { cwd: directory, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } }); children.push(child)
    child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream.stderr, { end: false })
    child.on('close', (code) => { stream.exit(code ?? 1); stream.end() }); stream.on('close', () => { if (child.exitCode === null) child.kill('SIGTERM') })
  } })
  proxy = await socksFixture(remote.port, { auth: true })
  servers = new ServerService(new Store(join(directory, 'fixture.sqlite'))); servers.unlock(randomBytes(32))
  const credential = servers.saveCredential({ name: 'fixture target', kind: 'password', password: 'target-secret' })
  const proxyCredential = servers.saveCredential({ name: 'fixture proxy', kind: 'password', password: 'proxy-secret' })
  const server = servers.saveServer({ name: 'Synthetic compatibility target', host: 'target.internal', port: remote.port, username: 'target-user', credentialId: credential.id, route: { type: 'socks5', host: '127.0.0.1', port: proxy.port, authentication: { type: 'password', username: 'proxy-user', credentialId: proxyCredential.id } } })
  const challenge = await servers.testConnection(server.id); assert.equal(challenge.status, 'host-key-required'); if (challenge.status === 'host-key-required') servers.trustHost(challenge.challengeId)
  operations = new OperationService(servers)
  const access = operations.createProfile({ name: 'isolated compatibility clients', serverIds: [server.id], mode: 'confirm-each', expiresAt: Date.now() + 600000 })
  ai = new AiService(servers); investigations = new InvestigationService(operations, ai)
  const applications = new ApplicationService(operations, investigations)
  const logPath = join(directory, 'synthetic.log'); writeFileSync(logPath, 'synthetic login failed\n')
  const application = applications.save({ serverId: server.id, revision: 0, name: 'Fixture login', aliases: ['lpp'], description: '', environment: 'test', deploymentPath: directory, runtime: 'process', runtimeTarget: 'synthetic', logSources: [{ id: randomUUID(), name: 'Synthetic file', kind: 'file', target: logPath, timezone: 'UTC' }] })
  mcp = new LocalMcpServer(operations, 0, applications); const endpoint = (await mcp.start()).url!
  const codexDirectory = join(directory, 'codex'), claudeDirectory = join(directory, 'claude')
  mkdirSync(codexDirectory, { mode: 0o700 }); mkdirSync(claudeDirectory, { mode: 0o700 })
  writeFileSync(join(codexDirectory, 'config.toml'), `[analytics]\nenabled=false\n[mcp_servers.hostharbor_fixture]\nurl=${JSON.stringify(endpoint)}\nhttp_headers={Authorization=${JSON.stringify('Bearer ' + access.token)}}\n`, { mode: 0o600 })
  const claudeConfig = join(directory, 'mcp.json')
  writeFileSync(claudeConfig, JSON.stringify({ mcpServers: { hostharbor_fixture: { type: 'http', url: endpoint, headers: { Authorization: 'Bearer ' + access.token } } } }), { mode: 0o600 })
  writeFileSync(join(claudeDirectory, '.claude.json'), JSON.stringify({ mcpServers: { hostharbor_fixture: { type: 'http', url: endpoint, headers: { Authorization: 'Bearer ' + access.token } } } }), { mode: 0o600 })
  // These are protocol clients, not model/agent turns. No account credentials are copied.
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { cwd: directory, env: { PATH: process.env.PATH, CODEX_HOME: codexDirectory, TMPDIR: tmpdir() }, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child)
  child.stderr.on('data', () => {})
  let seq = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  createInterface({ input: child.stdout }).on('line', (line) => { try { const msg = JSON.parse(line); const job = pending.get(msg.id); if (job) { clearTimeout(job.timer); pending.delete(msg.id); msg.error ? job.reject(new Error(`Protocol error ${msg.error.code}: ${String(msg.error.message).replaceAll(access.token, '[REDACTED]')}`)) : job.resolve(msg.result) } } catch {} })
  const call = (method: string, params: unknown) => new Promise<any>((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 30000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n') })
  const init = await call('initialize', { clientInfo: { name: 'hostharbor_compatibility_test', version: '1' }, capabilities: { experimentalApi: true } }); child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  const inventory = await call('mcpServerStatus/list', { serverName: 'hostharbor_fixture', detail: 'toolsAndAuthOnly' })
  console.log('Codex discovered tools:', Object.keys(inventory.data[0].tools).sort().join(', '))
  const thread = await call('thread/start', { cwd: directory, ephemeral: true, config: { analytics: { enabled: false } } })
  const threadId = thread.thread.id
  let tools: any
  for (let i = 0; i < 20; i++) { tools = await call('mcpServerStatus/list', { threadId, serverName: 'hostharbor_fixture', detail: 'toolsAndAuthOnly' }); if (JSON.stringify(tools).includes('start_command')) break; await wait(100) }
  const tool = async (name: string, args: unknown) => {
    const result = await call('mcpServer/tool/call', { threadId, server: 'hostharbor_fixture', tool: name, arguments: args })
    const content = result.content ?? result.result?.content ?? result
    if (!Array.isArray(content)) throw new Error('Unexpected tool result shape: ' + Object.keys(result).join(','))
    return JSON.parse(content.find((c: any) => c.type === 'text').text)
  }
  const visible = await tool('list_servers', {}); assert.equal(visible[0].id, server.id)
  const op = await tool('start_command', { serverId: server.id, requestKey: 'codex-fixture-command', command: "printf 'compatibility-ok\\n'; printf 'stderr-ok\\n' >&2", cwd: directory })
  assert.equal(op.state, 'awaiting_approval'); assert.equal(remote.sessions, 0)
  operations.decide({ id: op.id, approve: true })
  let done
  for (let i = 0; i < 80; i++) { done = await tool('get_operation', { id: op.id }); if (done.state === 'succeeded') break; await wait(50) }
  assert.equal(done.state, 'succeeded'); assert.equal(done.exitCode, 0); assert.equal(done.confirmedCwd, realpathSync(directory))
  const output = await tool('read_output', { id: op.id, cursor: 0 }); assert.ok(output.chunks.map((c: any) => c.text).join('').includes('compatibility-ok'))
  assert.equal(Object.keys(inventory.data[0].tools).length, 12)
  const context = await tool('get_server_context', { serverId: server.id }); assert.equal(context.applications[0].id, application.id)
  const found = await tool('find_applications', { serverId: server.id, query: 'lpp' }); assert.equal(found.applications[0].id, application.id)
  const logOperation = await tool('query_application_logs', { serverId: server.id, applicationId: application.id, applicationRevision: application.revision, sourceId: application.logSources[0].id, requestKey: 'codex-fixture-log', since: '2026-10-21T00:00:00Z', until: '2026-10-21T00:30:00Z', contains: 'login' })
  assert.equal(logOperation.state, 'awaiting_approval'); assert.equal(logOperation.context.timeWindowApplied, false)
  operations.decide({ id: logOperation.id, approve: true })
  for (let i = 0; i < 80; i++) { done = await tool('get_operation', { id: logOperation.id }); if (done.state === 'succeeded') break; await wait(50) }
  assert.equal(done.state, 'succeeded')
  const logOutput = await tool('read_output', { id: logOperation.id, cursor: 0 }); assert.ok(logOutput.chunks.map((c: any) => c.text).join('').includes('synthetic login failed'))
  console.log('PASS: Codex eight MCP tools, app alias/context, approved file-log shell execution via SOCKS5 and output; no inference')
  const claude = spawn('claude', ['--bare', '--mcp-config', claudeConfig, '--strict-mcp-config', 'mcp', 'list'], { cwd: directory, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: claudeDirectory, TMPDIR: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(claude)
  let claudeOutput = ''
  claude.stdout.on('data', (data) => { claudeOutput = (claudeOutput + data.toString()).slice(-65536) }); claude.stderr.on('data', () => {})
  let claudeTimer: ReturnType<typeof setTimeout>
  const exit = await Promise.race([new Promise<number | null>((resolve) => claude.on('exit', resolve)), new Promise<number>((resolve) => { claudeTimer = setTimeout(() => { claude.kill(); resolve(-1) }, 30000) })]); clearTimeout(claudeTimer!)
  assert.equal(exit, 0); assert.ok(/Connected|✓/i.test(claudeOutput), 'Claude Code did not report a successful fixture connection')
  console.log('PASS: Claude Code actual MCP health check; no inference, no user configuration changes')
} catch (error) { console.error(error instanceof Error ? error.message : 'Compatibility check failed'); process.exitCode = 1 }
finally {
  await Promise.all(children.map((child) => new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode) { resolve(); return } const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2000); child.once('exit', () => { clearTimeout(timer); resolve() }); child.kill('SIGTERM') })))
  await mcp?.stop(); investigations?.close(); ai?.close(); operations?.close(); servers?.close(); await proxy?.close(); await remote?.close()
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  console.log('Temporary compatibility data removed')
}

}
void main()
