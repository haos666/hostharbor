import { mcpInstructions } from '../src/shared/mcp-instructions'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Store } from '../src/core/storage/database'
import { ServerService } from '../src/core/servers/service'
import { OperationService } from '../src/core/operations/service'
import { LocalMcpServer } from '../src/core/mcp/server'
import { sshFixture } from './helpers/routes'
import type { Operation } from '../src/shared/contracts'

describe('authenticated loopback MCP transport', () => {
  let servers: ServerService, operations: OperationService, mcp: LocalMcpServer
  let remote: Awaited<ReturnType<typeof sshFixture>>, access: ReturnType<OperationService['createProfile']>, second: ReturnType<OperationService['createProfile']>
  const clients: Client[] = []; let targetId: string, endpoint: string
  beforeAll(async () => {
    remote = await sshFixture({ exec: (command, stream) => { const marker = command.match(/[a-f0-9]{48}/)![0]; stream.write(`${marker}\0/fixture\0synthetic result\n`); setTimeout(() => { stream.exit(0); stream.end() }, 10) } })
    servers = new ServerService(new Store(':memory:')); servers.unlock(randomBytes(32))
    const credential = servers.saveCredential({ name: 'fixture', kind: 'password', password: 'target-secret' })
    const server = servers.saveServer({ name: 'fixture', host: '127.0.0.1', port: remote.port, username: 'target-user', credentialId: credential.id }); targetId = server.id
    const first = await servers.testConnection(server.id); if (first.status !== 'host-key-required') throw new Error('Expected challenge'); servers.trustHost(first.challengeId)
    operations = new OperationService(servers)
    access = operations.createProfile({ name: 'SDK client fixture', serverIds: [server.id], mode: 'confirm-each', expiresAt: Date.now() + 60000 })
    second = operations.createProfile({ name: 'HTTP client fixture', serverIds: [server.id], mode: 'confirm-each', expiresAt: Date.now() + 60000 })
    mcp = new LocalMcpServer(operations, 0); endpoint = (await mcp.start()).url!
  })
  afterAll(async () => { for (const client of clients) await client.close(); await mcp?.stop(); operations?.close(); servers?.close(); await remote?.close() })
  async function connect(token: string) {
    const client = new Client({ name: 'untrusted supplied name', version: '1.0.0' })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    return client
  }
  const unpack = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text)
  it('connects official SDK client, exposes command and file tools, and runs through desktop approval', async () => {
    const client = await connect(access.token)
    expect(client.getInstructions()).toBe(mcpInstructions)
    const publishedTools = (await client.listTools()).tools
    expect(publishedTools.map((t) => t.name).sort()).toEqual(['cancel_operation', 'download_file', 'get_file_access', 'get_operation', 'list_remote_files', 'list_servers', 'read_output', 'start_command', 'upload_file'])
    const servers = unpack(await client.callTool({ name: 'list_servers', arguments: {} }))
    const discoveryMetadata = JSON.stringify({ instructions: client.getInstructions(), tools: publishedTools })
    for (const server of servers) for (const value of [server.id, server.name, server.host, server.username]) expect(discoveryMetadata).not.toContain(value)
    expect(servers[0].id).toBe(targetId); expect(JSON.stringify(servers)).not.toContain('credential')
    const args = { serverId: targetId, requestKey: 'sdk-idempotent', command: 'fixture command', cwd: '/fixture' }
    const op = unpack(await client.callTool({ name: 'start_command', arguments: args })) as Operation
    expect(op.state).toBe('awaiting_approval'); expect(remote.sessions).toBe(0)
    expect(op.agentGuidance?.approvalWaitUntil).toBe(access.profile.expiresAt)
    expect(op.agentGuidance?.approvalExpiresAt).toBe(access.profile.expiresAt)
    operations.decide({ id: op.id, approve: true })
    await vi.waitFor(async () => expect(unpack(await client.callTool({ name: 'get_operation', arguments: { id: op.id } })).state).toBe('succeeded'))
    expect(unpack(await client.callTool({ name: 'start_command', arguments: args })).id).toBe(op.id)
    const output = unpack(await client.callTool({ name: 'read_output', arguments: { id: op.id, cursor: 0 } }))
    expect(output.chunks.map((c: { text: string }) => c.text).join('')).toContain('synthetic result')
    const other = await connect(second.token)
    const denied = unpack(await other.callTool({ name: 'get_operation', arguments: { id: op.id } }))
    expect(denied.error.code).toBe('ACCESS_DENIED'); expect(remote.sessions).toBe(1)
  })
  it('blocks missing auth, hostile Host/Origin, query tokens, unrelated routes and GET streams', async () => {
    const headers = { Authorization: `Bearer ${access.token}` }
    expect((await fetch(endpoint, { method: 'POST' })).status).toBe(401)
    const badHost = await new Promise<number | undefined>((resolve, reject) => { const req = request(endpoint, { method: 'POST', headers: { ...headers, Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode) }); req.on('error', reject); req.end() })
    expect(badHost).toBe(403)
    expect((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' } })).status).toBe(403)
    expect((await fetch(endpoint + '?token=synthetic', { method: 'POST', headers })).status).toBe(404)
    expect((await fetch(endpoint.replace('/mcp', '/credentials'), { method: 'POST', headers })).status).toBe(404)
    expect((await fetch(endpoint, { headers })).status).toBe(405)
    expect((await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: ' '.repeat(65537) })).status).toBe(413)
  })
  it('returns immediate approval guidance, hands off aged waits, and resumes only the original operation', async () => {
    const profile = operations.createProfile({ name: 'synthetic wait fixture', serverIds: [targetId], mode: 'policy', expiresAt: null })
    const client = await connect(profile.token), sessions = remote.sessions
    const args = { serverId: targetId, requestKey: 'synthetic-wait', command: 'synthetic pending command', cwd: '/fixture' }
    const pending = unpack(await client.callTool({ name: 'start_command', arguments: args })) as Operation
    expect(pending).toMatchObject({ state: 'awaiting_approval', intentAt: null, agentGuidance: { operationId: pending.id, nextAction: 'poll', pollAfterMs: 10000, automaticResubmitAllowed: false, resume: { tool: 'get_operation', arguments: { id: pending.id } } } })
    expect(pending.agentGuidance!.approvalWaitUntil).toBe(pending.createdAt + 180000)
    expect(pending.agentGuidance!.approvalExpiresAt).toBe(pending.createdAt + 300000)
    expect(pending.agentGuidance!.message).toContain('立即告知用户')
    expect(remote.sessions).toBe(sessions)
    // Only age this synthetic row; no wall-clock/SDK timer changes or real wait.
    const agedAt = Date.now() - 180001
    servers.store.db.prepare('UPDATE operations SET createdAt=? WHERE id=?').run(agedAt, pending.id)
    const aged = unpack(await client.callTool({ name: 'get_operation', arguments: { id: pending.id } })) as Operation
    expect(aged).toMatchObject({ state: 'awaiting_approval', intentAt: null, agentGuidance: { nextAction: 'ask_user', pollAfterMs: null, approvalWaitUntil: agedAt + 180000 } })
    expect(aged.agentGuidance!.message).toContain('回复“继续”')
    const duplicate = unpack(await client.callTool({ name: 'start_command', arguments: args })) as Operation
    expect(duplicate.id).toBe(pending.id); expect(duplicate.createdAt).toBe(agedAt)
    expect(duplicate.agentGuidance!.approvalWaitUntil).toBe(aged.agentGuidance!.approvalWaitUntil)
    expect(duplicate.agentGuidance!.nextAction).toBe('ask_user')
    const waitingOutput = unpack(await client.callTool({ name: 'read_output', arguments: { id: pending.id } }))
    expect(waitingOutput).toMatchObject({ chunks: [], agentGuidance: { nextAction: 'ask_user', pollAfterMs: null } })
    expect(remote.sessions).toBe(sessions)
    operations.decide({ id: pending.id, approve: true })
    await vi.waitFor(async () => expect(unpack(await client.callTool({ name: 'get_operation', arguments: { id: pending.id } })).state).toBe('succeeded'))
    expect(unpack(await client.callTool({ name: 'get_operation', arguments: { id: pending.id } })).agentGuidance.nextAction).toBe('read_output')
    const output = unpack(await client.callTool({ name: 'read_output', arguments: { id: pending.id } }))
    expect(output.chunks.length).toBeGreaterThan(0)
    expect(unpack(await client.callTool({ name: 'read_output', arguments: { id: pending.id, cursor: output.nextCursor } })).agentGuidance.nextAction).toBe('stop')
    expect(remote.sessions).toBe(sessions + 1)
    const expiredArgs = { ...args, requestKey: 'synthetic-expired' }
    const expired = unpack(await client.callTool({ name: 'start_command', arguments: expiredArgs })) as Operation
    servers.store.db.prepare('UPDATE operations SET createdAt=? WHERE id=?').run(Date.now() - 300001, expired.id)
    const retry = unpack(await client.callTool({ name: 'start_command', arguments: expiredArgs })) as Operation
    expect(retry).toMatchObject({ id: expired.id, state: 'expired', intentAt: null, agentGuidance: { nextAction: 'stop', automaticResubmitAllowed: false } })
    expect(retry.agentGuidance!.message).toContain('原操作未执行')
    expect(() => operations.decide({ id: expired.id, approve: true })).toThrow()
    const denied = unpack(await client.callTool({ name: 'start_command', arguments: { ...args, requestKey: 'synthetic-rejected' } })) as Operation
    operations.decide({ id: denied.id, approve: false })
    expect(unpack(await client.callTool({ name: 'get_operation', arguments: { id: denied.id } }))).toMatchObject({ state: 'denied', agentGuidance: { nextAction: 'stop', pollAfterMs: null } })
    expect(remote.sessions).toBe(sessions + 1)
  })
  it('interoperates with direct stateless JSON-RPC and immediately rejects revoked tokens', async () => {
    const headers = { Authorization: `Bearer ${second.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    const result = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: access.profile.name, version: '1' } } }) })
    expect(result.status).toBe(200); expect((await result.json()).result.serverInfo.name).toBe('hostharbor')
    operations.revokeProfile(second.profile.id)
    expect((await fetch(endpoint, { method: 'POST', headers, body: '{}' })).status).toBe(401)
  })
  it('fails closed while locked and leaves no listener after stop', async () => {
    const client = await connect(access.token)
    servers.lock()
    const result = unpack(await client.callTool({ name: 'list_servers', arguments: {} }))
    expect(result.error.code).toBe('VAULT_LOCKED')
    await mcp.stop(); expect(mcp.status().running).toBe(false)
    await expect(fetch(endpoint)).rejects.toThrow()
  })
})
