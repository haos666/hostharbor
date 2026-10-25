import { afterEach, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { normalizeElevation, SudoConversation } from '../src/core/operations/sudo'
import { sshFixture } from './helpers/routes'
import type { CommandInput } from '../src/shared/contracts'
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
async function fixture(options: { wrong?: boolean; reject?: boolean; noPrompt?: boolean; drop?: boolean; hold?: boolean; permissive?: boolean } = {}) {
  const commands: string[] = [], inputBytes: string[] = []
  const remote = await sshFixture({ exec: (command, stream) => {
    commands.push(command)
    const marker = [...command.matchAll(/[a-f0-9]{48}/g)].at(-1)![0]
    const prompt = command.match(/HH_SUDO_[a-f0-9]{48}:/)?.[0]
    if (options.reject) { stream.stderr.write('sudo: synthetic policy denied\n'); stream.exit(1); stream.end(); return }
    const done = () => { stream.write(`${marker}\0/synthetic/root\0`); stream.write('synthetic privilege output\n'); stream.exit(0); stream.end() }
    if (!prompt || options.noPrompt) { stream.on('data', (d: Buffer) => inputBytes.push(d.toString())); done(); return }
    stream.on('data', (d: Buffer) => {
      inputBytes.push(d.toString())
      if (options.hold) return
      if (options.drop) { stream.end(); return }
      if (options.wrong) { stream.stderr.write(prompt); return }
      stream.stderr.write('synthetic-elevation-secret\n') // hostile echo must be redacted
      done()
    })
    stream.stderr.write('sudo notice\n' + prompt.slice(0, 13))
    setTimeout(() => stream.stderr.write(prompt.slice(13)), 5)
  } })
  cleanup.push(() => remote.close())
  const servers = new ServerService(new Store(':memory:')); servers.unlock(randomBytes(32))
  const login = servers.saveCredential({ name: 'Synthetic login', kind: 'password', password: 'target-secret' })
  const elevation = servers.saveCredential({ name: 'Synthetic elevation', kind: 'password', password: 'synthetic-elevation-secret' })
  const server = servers.saveServer({ name: 'Synthetic sudo target', host: '127.0.0.1', port: remote.port, username: 'target-user', credentialId: login.id, elevation: { type: 'sudo', passwordSource: 'credential', credentialId: elevation.id } })
  const challenge = await servers.testConnection(server.id); if (challenge.status !== 'host-key-required') throw Error('fixture')
  servers.trustHost(challenge.challengeId)
  const operations = new OperationService(servers);cleanup.push(() => { operations.close(); servers.close() })
  const access = operations.createProfile({ name: 'Synthetic sudo client', serverIds: [server.id], mode: 'policy', expiresAt: Date.now() + 60000 })
  operations.policy.save({ revision: 0, mode: options.permissive ? 'permissive' : 'all-approval', rules: [], permissiveConfirmed: true })
  const input: CommandInput = { serverId: server.id, requestKey: randomUUID(), command: 'id', cwd: '/', timeoutMs: 2000, connectTimeoutMs: 2000, elevation: 'sudo' }
  const { revision: _revision, createdAt: _createdAt, ...serverInput } = server
  return { operations, servers, server: serverInput, login, elevation, access, input, commands, inputBytes }
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  for (let n = 0; n < 150; n++) { const o = f.operations.get(id); if (['succeeded', 'failed', 'unknown', 'interrupted'].includes(o.state)) return o; await new Promise(r => setTimeout(r, 10)) }
  throw Error('fixture deadline')
}
it('automatically elevates routine maintenance in permissive mode but still approves destructive commands', async () => {
  const f = await fixture({ permissive: true })
  const o = f.operations.start(f.access.profile.id, { ...f.input, command: 'systemctl restart synthetic.service' })
  expect(o.state).not.toBe('awaiting_approval')
  expect((await finish(f, o.id)).state).toBe('succeeded'); expect(f.inputBytes).toEqual(['synthetic-elevation-secret\n'])
  const destructive = f.operations.start(f.access.profile.id, { ...f.input, requestKey: randomUUID(), command: 'rm /srv/synthetic' })
  expect(destructive.state).toBe('awaiting_approval'); expect(f.commands).toHaveLength(1)
  f.operations.policy.save({ ...f.operations.policy.get(), mode: 'paused' })
  expect(f.operations.start(f.access.profile.id, { ...f.input, requestKey: randomUUID() }).state).toBe('denied')
})
it('binds independent credentials and manually approves root in all-approval mode; no secret in command/result/output', async () => {
  const f = await fixture(), o = f.operations.start(f.access.profile.id, f.input)
  expect(o.state).toBe('awaiting_approval');expect(f.commands).toEqual([])
  expect(o.dependencies.some(d => d.id === f.elevation.id)).toBe(true)
  f.operations.decide({ id: o.id, approve: true })
  const done = await finish(f, o.id);expect(done.state).toBe('succeeded');expect(done.confirmedCwd).toBe('/synthetic/root')
  expect(f.inputBytes).toEqual(['synthetic-elevation-secret\n'])
  expect(f.commands[0]).toContain('/usr/bin/sudo -k -S');expect(f.commands[0]).toContain('exec </dev/null')
  const output = f.operations.read(o.id, 0).chunks.map(c => c.text).join('')
  expect(output).toContain('[REDACTED]');expect(output).not.toContain('HH_SUDO_')
  expect(JSON.stringify([done, output, f.commands])).not.toContain('synthetic-elevation-secret')
  expect(f.operations.start(f.access.profile.id, f.input).id).toBe(o.id)
})
it('reuses login passwords only when selected, supports no-password sudo without sending anything', async () => {
  const f = await fixture()
  f.servers.saveServer({ ...f.server, elevation: { type: 'sudo', passwordSource: 'login' } })
  const o = f.operations.start(f.access.profile.id, f.input);f.operations.decide({ id: o.id, approve: true });expect((await finish(f, o.id)).state).toBe('succeeded');expect(f.inputBytes).toEqual(['target-secret\n'])
  f.servers.saveServer({ ...f.server, elevation: { type: 'sudo', passwordSource: 'none' } })
  const n = f.operations.start(f.access.profile.id, { ...f.input, requestKey: randomUUID() });f.operations.decide({ id: n.id, approve: true });expect((await finish(f, n.id)).state).toBe('succeeded');expect(f.commands.at(-1)).toContain('-k -n');expect(f.inputBytes).toHaveLength(1)
})
it('never sends a configured password on an ordinary command or passwordless success', async () => {
  const f = await fixture({ noPrompt: true })
  const ordinary = f.operations.start(f.access.profile.id, { ...f.input, requestKey: randomUUID(), elevation: undefined });f.operations.decide({ id: ordinary.id, approve: true });expect((await finish(f, ordinary.id)).state).toBe('succeeded')
  const o = f.operations.start(f.access.profile.id, f.input);f.operations.decide({ id: o.id, approve: true });expect((await finish(f, o.id)).state).toBe('succeeded');expect(f.inputBytes).toEqual([])
})
it('does not retry a password after a repeated prompt; disconnect outcome stays unknown', async () => {
  const f = await fixture({ wrong: true }), o = f.operations.start(f.access.profile.id, f.input);f.operations.decide({ id: o.id, approve: true })
  expect(await finish(f, o.id)).toMatchObject({ state: 'unknown', errorCode: 'SUDO_FAILED' });expect(f.inputBytes).toHaveLength(1)
})
it('does not retry an interrupted elevated command', async () => {
  const f = await fixture({ drop: true }), o = f.operations.start(f.access.profile.id, f.input);f.operations.decide({ id: o.id, approve: true });expect((await finish(f, o.id)).state).toBe('unknown');expect(f.commands).toHaveLength(1)
})
it('credential updates invalidate pending approvals; bound credentials cannot be deleted or converted', async () => {
  const f = await fixture(), o = f.operations.start(f.access.profile.id, f.input)
  expect(() => f.servers.deleteCredential(f.elevation.id)).toThrow()
  expect(() => f.servers.saveCredential({ id: f.elevation.id, name: 'Synthetic replacement', kind: 'private-key', privateKey: 'invalid' })).toThrow(/提权/)
  f.servers.saveCredential({ id: f.elevation.id, name: 'Synthetic elevation', kind: 'password', password: 'synthetic-new-password' })
  expect(() => f.operations.decide({ id: o.id, approve: true })).toThrow();expect(f.commands).toEqual([])
})
it('rejects unconfigured sudo and line-breaking password without sending SSH commands', async () => {
  const f = await fixture();f.servers.saveServer({ ...f.server, elevation: { type: 'none' } });expect(() => f.operations.start(f.access.profile.id, f.input)).toThrow(/提权/)
  f.servers.saveCredential({ id: f.elevation.id, name: 'Synthetic multiline', kind: 'password', password: 'synthetic\npassword' });f.servers.saveServer(f.server)
  expect(() => f.operations.start(f.access.profile.id, f.input)).toThrow(/提权/);expect(f.commands).toEqual([])
})
it('normalizes only an unambiguous literal sudo command and rejects guessing compound scope', () => {
  const base: CommandInput = { serverId: randomUUID(), requestKey: 'synthetic', command: 'sudo -u root id', cwd: '/', timeoutMs: 1000, connectTimeoutMs: 1000 }
  expect(normalizeElevation(base)).toMatchObject({ elevation: 'sudo', command: "'id'" })
  for (const command of ['sudo id; id', 'sudo id | cat', 'sudo -u other id', 'sudo -S id', 'sudo $(id)']) expect(() => normalizeElevation({ ...base, command })).toThrow()
  expect(normalizeElevation({ ...base, command: "echo 'sudo id'" }).elevation).toBeUndefined()
})
it('handles split prompts, wipes secret buffers and does not respond after readiness', () => {
  const secret = Buffer.from('synthetic'), sent: Buffer[] = [], c = new SudoConversation('PROMPT_TOKEN', secret, b => sent.push(b))
  expect(c.stderr(Buffer.from('hello PRO')).toString()).toBe('hello ')
  expect(c.stderr(Buffer.from('MPT_TOKEN')).length).toBe(0);expect(sent[0].toString()).toBe('synthetic\n');expect(secret.every(b => b === 0)).toBe(true)
  c.ready();expect(c.stderr(Buffer.from('PROMPT_TOKEN')).toString()).toBe('PROMPT_TOKEN');expect(sent).toHaveLength(1);c.close()
})

it('reports a confirmed sudo rejection as failed without sending a password', async () => {
  const f = await fixture({ reject: true }), o = f.operations.start(f.access.profile.id, f.input); f.operations.decide({ id: o.id, approve: true })
  expect(await finish(f, o.id)).toMatchObject({ state: 'failed', errorCode: 'SUDO_FAILED', exitCode: 1 }); expect(f.inputBytes).toEqual([])
})
it('honors pause and revocation without automatic elevation or password retries', async () => {
  const f = await fixture()
  f.operations.policy.save({ ...f.operations.policy.get(), mode: 'paused' })
  const denied = f.operations.start(f.access.profile.id, f.input); expect(denied.state).toBe('denied'); expect(f.commands).toEqual([])
  f.operations.policy.save({ ...f.operations.policy.get(), mode: 'all-approval' })
  const pending = f.operations.start(f.access.profile.id, { ...f.input, requestKey: randomUUID() }); f.operations.revokeProfile(f.access.profile.id)
  expect(() => f.operations.decide({ id: pending.id, approve: true })).toThrow(); expect(f.commands).toEqual([]); expect(f.inputBytes).toEqual([])
})

it('preserves the original sudo command for exact deny rules and approval evidence', async () => {
  const f = await fixture({ permissive: true }), command = 'sudo id'
  f.operations.policy.save({ ...f.operations.policy.get(), rules: [{ id: randomUUID(), name: 'Synthetic exact deny', enabled: true, action: 'deny', profileIds: [], serverIds: [], command, cwd: null, expiresAt: null }] })
  const op = f.operations.start(f.access.profile.id, { ...f.input, command, elevation: undefined })
  expect(op.state).toBe('denied'); expect(op.input.command).toBe(command); expect(op.input.elevation).toBe('sudo'); expect(f.commands).toEqual([])
})
