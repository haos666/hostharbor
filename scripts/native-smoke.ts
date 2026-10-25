import { sftpFixture } from '../tests/helpers/sftp'
import { mcpInstructions } from '../src/shared/mcp-instructions'
import { diagnosticQueries } from '../tests/helpers/diagnostic-cases'
import { operationApproval } from '../src/shared/operation-approval'
import { DatabaseSync } from 'node:sqlite'
import { IdleLockService, IdleLockSettingsStore } from '../src/main/idle-lock'
import { NativeApprovalNotification, setApprovalBadge } from '../src/main/notifications/native'
import { NotificationSettingsStore } from '../src/main/notifications/settings'
import { copyMcpInstallation } from '../src/main/mcp-installation'
import type { ApplicationRecord } from '../src/shared/application'
import { fixtureReport, requestEvidence } from '../tests/helpers/investigation'
import { isInvestigating, type InvestigationView } from '../src/shared/dossier'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { sshFixture } from '../tests/helpers/routes'
import type { ConnectionTest, Operation } from '../src/shared/contracts'
import { createServer, type Server as HttpServer } from 'node:http'
import { app, safeStorage, nativeImage, clipboard, powerMonitor } from 'electron'
import { randomUUID, randomBytes } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { SecurityService } from '../src/core/security/service'
import assert from 'node:assert/strict'
import { applicationIcon, createBrandTray } from '../src/main/branding'
import { CoreClient } from '../src/main/core-client'
import { KeyStore } from '../src/main/key-store'
import type { AppStatus, CredentialSummary, ServerRecord } from '../src/shared/contracts'

// No renderer or production data: only temporary storage and generated synthetic secrets.
const directory = process.argv[2]
if (!directory || !isAbsolute(directory)) throw new Error('Native smoke requires a temporary directory from its parent runner')
app.setPath('userData', directory)
const deadline = setTimeout(() => { console.error('Native smoke timed out'); app.exit(1) }, 45000)
void app.whenReady().then(async () => {
  let core: CoreClient | undefined
  let generated: Buffer | undefined
  let loaded: Buffer | undefined
  let fixture: Awaited<ReturnType<typeof sshFixture>> | undefined
  let client: Client | undefined
  let nativeSudo: Awaited<ReturnType<typeof sshFixture>> | undefined
  let nativeFiles: Awaited<ReturnType<typeof sftpFixture>> | undefined
  let aiFixture: HttpServer | undefined
  let exitCode = 1
  try {
    const brandDirectory = join(process.cwd(), 'resources/branding')
    assert.deepEqual(applicationIcon(brandDirectory).getSize(), { width: 1024, height: 1024 })
    if (process.platform === 'darwin') {
      const template = nativeImage.createFromPath(join(brandDirectory, 'trayTemplate.png'))
      assert.deepEqual(template.getSize(), { width: 18, height: 18 })
      assert.ok(template.getScaleFactors().includes(2))
    }
    const actions = { open: 0, lock: 0, quit: 0 }
    const statusBrand = createBrandTray({ show: () => { actions.open++ }, lock: () => { actions.lock++ }, quit: () => { actions.quit++ } }, brandDirectory)
    try {
      assert.equal(statusBrand.tray.isDestroyed(), false)
      statusBrand.setApprovalCount(2)
      assert.equal(statusBrand.menu.getMenuItemById('approvals')!.label, '审批中心 · 2 项待审批')
      if (process.platform === 'darwin') assert.equal(statusBrand.tray.getTitle(), '2')
      statusBrand.setApprovalCount(0)
      if (process.platform === 'darwin') assert.equal(statusBrand.tray.getTitle(), '')
      for (const id of ['open', 'lock', 'quit']) {
        const item = statusBrand.menu.getMenuItemById(id)!
        item.click(undefined as never, undefined as never, {} as never)
      }
      assert.deepEqual(actions, { open: 1, lock: 1, quit: 1 })
    } finally { statusBrand.tray.destroy() }
    assert.equal(statusBrand.tray.isDestroyed(), true)
    const notificationSettings = new NotificationSettingsStore(directory)
    notificationSettings.save({ revision: 0, badge: true, system: true, sound: false })
    assert.equal(new NotificationSettingsStore(directory).get().sound, false)
    setApprovalBadge(2)
    if (process.platform === 'darwin') assert.equal(app.dock?.getBadge(), '2')
    setApprovalBadge(0)
    if (process.platform === 'darwin') assert.equal(app.dock?.getBadge(), '')
    const notifications = new NativeApprovalNotification()
    if (notifications.supported()) {
      const delivery = await notifications.show(null, false, () => {})
      assert.ok(['shown', 'failed', 'unknown'].includes(delivery))
      console.log(`PASS: native notification reports ${delivery}; OS visibility still depends on signing/permissions`)
      notifications.close()
    }
    console.log('PASS: real app image, Retina template and native tray menu dispatch/cleanup')
    const keys = new KeyStore(directory)
    generated = randomBytes(32)
    // Build a legacy fixture to verify migration through real OS protection.
    writeFileSync(keys.path, await safeStorage.encryptStringAsync(generated.toString('base64')), { mode: 0o600 })
    loaded = await keys.legacyKey()
    assert.ok(generated.equals(loaded))
    console.log('PASS: OS-protected legacy key round trip')
    core = new CoreClient(directory, join(process.cwd(), 'out/main/core.cjs'), 0)
    assert.equal((await core.call<{ vault: AppStatus['vault'] }>('status')).vault, 'not-configured')
    await core.call('unlock', loaded)
    const credential = await core.call<CredentialSummary>('saveCredential', { name: 'synthetic native smoke', kind: 'password', password: randomBytes(24).toString('hex') })
    assert.equal((await core.call<CredentialSummary[]>('listCredentials'))[0].id, credential.id)
    const server = await core.call<ServerRecord>('saveServer', { name: 'synthetic native server', host: '127.0.0.1', port: 1, username: 'synthetic', credentialId: null })
    await assert.rejects(core.call('testConnection', server.id), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CREDENTIAL_REQUIRED')
    const bound = await core.call<ServerRecord>('saveServer', { id: server.id, name: server.name, host: server.host, port: server.port, username: server.username, credentialId: credential.id, route: { type: 'socks5', host: '127.0.0.1', port: 1080, authentication: { type: 'none' } } })
    assert.equal(bound.credentialId, credential.id)
    const maintainedApp = await core.call<ApplicationRecord>('saveApplication', { serverId: server.id, revision: 0, name: 'Native application', aliases: ['native-lpp'], description: 'Synthetic login service', environment: 'test', deploymentPath: '/srv/native', runtime: 'systemd', runtimeTarget: 'native.service', logSources: [{ id: randomUUID(), name: 'service', kind: 'journal', target: 'native.service', timezone: 'UTC' }] })
    const password = randomBytes(24).toString('hex')
    const recovery = randomBytes(32).toString('hex')
    const security = new SecurityService(keys, core)
    await security.setup({ password, recovery })
    assert.equal(keys.mode, 'password')
    await assert.rejects(keys.legacyKey())
    await assert.rejects(core.call('listCredentials'))
    await assert.rejects(core.call('listApplications', server.id))
    await security.unlock(password)
    assert.equal((await core.call<CredentialSummary[]>('listCredentials'))[0].id, credential.id)
    const initialPolicy = await core.call<any>('getApprovalPolicy')
    assert.equal(initialPolicy.mode, 'all-approval')
    await core.call('saveApprovalPolicy', { ...initialPolicy, mode: 'paused' })
    const recordingSettings=await core.call<any>('getRecordingStorage')
    assert.equal(recordingSettings.settings.retentionDays,7)
    await core.call('saveRecordingSettings',{...recordingSettings.settings,retentionDays:14})
    let preservedThinking = false
    let approvalAiRequests = 0
    const syntheticAiKey=randomBytes(24).toString('hex')
    aiFixture=createServer((request,response)=>{
      if (request.method === 'POST' && request.url === '/anthropic/v1/messages' && request.headers['x-api-key'] === syntheticAiKey) {
        let raw = ''; request.on('data', chunk => { raw += chunk }); request.on('end', () => {
          const body = JSON.parse(raw)
          if (body.tools[0]?.name === 'approval_review') {
            approvalAiRequests++
            const sent = JSON.parse(body.messages[0].content)
            assert.deepEqual(Object.keys(sent).sort(), ['command', 'cwd'])
            assert.ok(!raw.includes('target-secret'))
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'native-review', name: 'approval_review', input: { recommendation: 'query', risks: [], reason: 'Synthetic query candidate' } }] }))
            return
          }
          const evidence = requestEvidence(body)
          const probeFirst = body.tools.length === 1 && body.tools[0].name === 'investigate'
          if (body.messages.some((m: any) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'thinking' && c.signature === 'native-synthetic-signature'))) preservedThinking = true
          const call = probeFirst ? { id: 'native:followup', name: 'investigate', input: { query: 'process', target: '123', purpose: 'synthetic probe' } } : { id: 'native-report', name: 'save_report', input: fixtureReport(evidence[0].id) }
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ stop_reason: 'tool_use', content: [...(probeFirst ? [{ type: 'thinking', thinking: 'synthetic opaque state', signature: 'native-synthetic-signature' }] : []), { type: 'tool_use', ...call }] }))
        }); return
      }
      const anthropic=request.url==='/anthropic/v1/models?limit=100'
      const authorized=anthropic ? request.headers['x-api-key']===syntheticAiKey && request.headers['anthropic-version']==='2023-06-01' : request.url==='/openai/v1/models' && request.headers.authorization===`Bearer ${syntheticAiKey}`
      if(!authorized){response.writeHead(401);response.end();return}
      response.setHeader('content-type','application/json');response.end(JSON.stringify({data:[{id:'fixture-ai-model',display_name:'Native fixture'}],has_more:false}))
    })
    await new Promise<void>((resolve)=>aiFixture!.listen(0,'127.0.0.1',resolve))
    const aiBase=`http://127.0.0.1:${(aiFixture.address() as import('node:net').AddressInfo).port}`
    const aiInitial=await core.call<any>('getAiSettings');assert.equal(aiInitial.activeProvider,null)
    await core.call('saveAiProvider',{revision:0,provider:'openai',baseUrl:`${aiBase}/openai/v1`,model:'fixture-ai-model',apiKey:syntheticAiKey})
    await core.call('saveAiProvider',{revision:1,provider:'anthropic',baseUrl:`${aiBase}/anthropic/v1`,model:'fixture-ai-model',apiKey:syntheticAiKey})
    for(const provider of ['openai','anthropic']) {
      const models: {models:{id:string}[]}=await core.call<any>('listAiModels',{revision:2,provider,baseUrl:`${aiBase}/${provider}/v1`})
      assert.equal(models.models[0].id,'fixture-ai-model')
    }
    assert.ok(!JSON.stringify(await core.call('getAiSettings')).includes(syntheticAiKey))
    assert.deepEqual(await core.call('testAiTools', { revision: 2 }), { success: true }); assert.equal(preservedThinking, true)
    console.log('PASS: synthetic model capability probe preserves complete Anthropic continuation without SSH')
    await security.lock()
    await assert.rejects(core.call('getAiSettings'))
    await assert.rejects(core.call('getRecordingStorage'))
    await assert.rejects(core.call('getApprovalPolicy'))
    await core.stopAndWait()
    core = new CoreClient(directory, join(process.cwd(), 'out/main/core.cjs'), 0)
    assert.equal((await core.call<{ vault: AppStatus['vault'] }>('status')).vault, 'locked')
    const restarted = new SecurityService(new KeyStore(directory), core)
    const newPassword = randomBytes(24).toString('hex')
    await restarted.resetPassword({ recovery, newPassword })
    await restarted.unlock(newPassword)
    assert.equal((await core.call<CredentialSummary[]>('listCredentials'))[0].id, credential.id)
    assert.deepEqual((await core.call<ApplicationRecord[]>('listApplications', server.id))[0], maintainedApp)
    console.log('PASS: encrypted application context survives native Core restart and lock')
    assert.equal((await core.call<ServerRecord[]>('listServers'))[0].credentialId, credential.id)
    assert.deepEqual((await core.call<ServerRecord[]>('listServers'))[0].route, { type: 'socks5', host: '127.0.0.1', port: 1080, authentication: { type: 'none' } })
    assert.equal((await core.call<any>('getRecordingStorage')).settings.retentionDays,14)
    const restoredAi=await core.call<any>('getAiSettings');assert.equal(restoredAi.activeProvider,'anthropic');assert.equal(restoredAi.providers.openai.hasKey,true)
    assert.equal((await core.call<any>('listAiModels',{revision:2,provider:'openai',baseUrl:`${aiBase}/openai/v1`})).models[0].id,'fixture-ai-model')
    console.log('PASS: encrypted AI settings, two protocol model lists, locked access and restart with saved keys')
    const restoredPolicy = await core.call<any>('getApprovalPolicy')
    assert.equal(restoredPolicy.mode, 'paused'); assert.equal(restoredPolicy.revision, 1)
    await core.call('saveApprovalPolicy', { ...restoredPolicy, mode: 'all-approval' })
    console.log('PASS: encrypted approval policy survives utility restart and respects lock')
    console.log('PASS: unbound server, credential binding and server persistence')
    console.log('PASS: password migration, recovery reset and OS-protected envelope after restart')
    console.log('PASS: utility process, SQLite persistence, IPC, lock and restart')
    fixture = await sshFixture({ exec: (command, stream) => {
      const marker = command.match(/[a-f0-9]{48}/)![0]
      stream.write(`${marker}\0/native-fixture\0native synthetic output\nLinux synthetic OS\n`)
      setTimeout(() => { stream.exit(0); stream.end() }, 10)
    } })
    const commandCredential = await core.call<CredentialSummary>('saveCredential', { name: 'synthetic command credential', kind: 'password', password: 'target-secret' })
    const commandTarget = await core.call<ServerRecord>('saveServer', { name: 'synthetic command target', host: '127.0.0.1', port: fixture.port, username: 'target-user', credentialId: commandCredential.id })
    const challenge = await core.call<ConnectionTest>('testConnection', commandTarget.id)
    assert.equal(challenge.status, 'host-key-required')
    if (challenge.status !== 'host-key-required') throw new Error('Expected synthetic challenge')
    await core.call('trustHost', challenge.challengeId)
    const access = await core.call<{ token: string; profile: { id: string } }>('createProfile', { name: 'synthetic native client', serverIds: [commandTarget.id], mode: 'confirm-each', expiresAt: null })
    const mcp = await core.call<{ url: string }>('startMcp')
    client = new Client({ name: 'synthetic native client', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: { Authorization: `Bearer ${access.token}` } } }))
    assert.equal(client.getInstructions(), mcpInstructions)
    const unpack = (value: unknown) => JSON.parse((value as { content: { text: string }[] }).content[0].text)
    assert.equal((await client.listTools()).tools.length, 12)
    const logApp = await core.call<ApplicationRecord>('saveApplication', { serverId: commandTarget.id, revision: 0, name: 'Synthetic login service', aliases: ['lpp'], description: '', environment: 'test', deploymentPath: '/srv/synthetic', runtime: 'systemd', runtimeTarget: 'fixture.service', logSources: [{ id: randomUUID(), name: 'runtime', kind: 'journal', target: 'fixture.service', timezone: 'UTC' }] })
    assert.equal(unpack(await client.callTool({ name: 'find_applications', arguments: { serverId: commandTarget.id, query: 'lpp' } })).applications[0].id, logApp.id)
    const logOperation = unpack(await client.callTool({ name: 'query_application_logs', arguments: { serverId: commandTarget.id, applicationId: logApp.id, applicationRevision: logApp.revision, sourceId: logApp.logSources[0].id, requestKey: 'native-app-logs', since: '2026-10-21T00:00:00Z', until: '2026-10-21T00:30:00Z' } })) as Operation
    assert.equal(logOperation.state, 'awaiting_approval')
    assert.equal(logOperation.agentGuidance?.nextAction, 'poll')
    assert.equal(logOperation.agentGuidance?.approvalWaitUntil, logOperation.createdAt + 180000)
    await core.call('decideOperation', { id: logOperation.id, approve: true })
    for (let n = 0; n < 40; n++) { if ((await core.call<Operation>('getOperation', logOperation.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 50)) }
    assert.equal((await core.call<Operation>('getOperation', logOperation.id)).state, 'succeeded')
    assert.equal((await core.call<Operation>('getOperation', logOperation.id)).context?.source.target, 'fixture.service')
    console.log('PASS: native MCP app alias resolution and log operation use desktop approval and recording')
    const operation = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-smoke', cwd: '/native-fixture', command: 'synthetic command' } })) as Operation
    assert.equal(operation.state, 'awaiting_approval')
    assert.equal(operation.agentGuidance?.nextAction, 'poll')
    assert.equal(operation.agentGuidance?.approvalWaitUntil, operation.createdAt + 180000)
    // Age only a synthetic pending row; no test-only RPC or real 3-minute wait.
    const fixtureDb = new DatabaseSync(join(directory, 'hostharbor.sqlite'))
    const agedAt = Date.now() - 180001
    try { fixtureDb.prepare('UPDATE operations SET createdAt=? WHERE id=?').run(agedAt, operation.id) } finally { fixtureDb.close() }
    const handedOff = unpack(await client.callTool({ name: 'get_operation', arguments: { id: operation.id } })) as Operation
    assert.equal(handedOff.state, 'awaiting_approval')
    assert.equal(handedOff.agentGuidance?.nextAction, 'ask_user')
    assert.equal(handedOff.agentGuidance?.pollAfterMs, null)
    assert.equal(handedOff.agentGuidance?.resume.arguments.id, operation.id)
    assert.equal(handedOff.agentGuidance?.automaticResubmitAllowed, false)
    const repeated = unpack(await client.callTool({ name: 'start_command', arguments: { ...operation.input } })) as Operation
    assert.equal(repeated.id, operation.id)
    assert.equal(repeated.agentGuidance?.approvalWaitUntil, agedAt + 180000)
    const awaitingOutput = unpack(await client.callTool({ name: 'read_output', arguments: { id: operation.id, cursor: 0 } }))
    assert.equal(awaitingOutput.agentGuidance.nextAction, 'ask_user')
    assert.deepEqual((await core.call<any>('approvalSnapshot')).ids, [operation.id])
    await core.call('decideOperation', { id: operation.id, approve: true })
    let completed: Operation | undefined
    for (let attempt = 0; attempt < 40; attempt++) {
      completed = unpack(await client.callTool({ name: 'get_operation', arguments: { id: operation.id } })) as Operation
      if (completed.state === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(completed?.state, 'succeeded'); assert.equal(completed?.confirmedCwd, '/native-fixture'); assert.equal(completed?.exitCode, 0)
    assert.equal(completed?.agentGuidance?.nextAction, 'read_output')
    console.log('PASS: native MCP three-minute handoff, stable original request ID and post-handoff approval/result continuation')
    const output = unpack(await client.callTool({ name: 'read_output', arguments: { id: operation.id, cursor: 0 } }))
    assert.ok(output.chunks.map((chunk: { text: string }) => chunk.text).join('').includes('native synthetic output'))
    const history=await core.call<any>('queryHistory',{serverId:commandTarget.id,state:'succeeded',search:'synthetic command'})
    assert.equal(history.total,2);assert.equal(history.operations[0].humanDecision,'approved')
    assert.ok(history.operations[0].decidedAt)
    const queryPage = await core.call<any>('queryHistory', { serverId: commandTarget.id, pageSize: 20, offset: 0, includeOptions: true })
    assert.equal(queryPage.pageSize, 20); assert.equal(queryPage.total, 2)
    assert.ok(queryPage.options.profiles.some((p: any) => p.id === access.profile.id))
    assert.ok(queryPage.options.servers.some((s: any) => s.id === commandTarget.id))
    assert.equal((await core.call<any>('queryHistory', { stateGroup: 'active', pageSize: 20 })).total, 0)
    assert.equal((await core.call<any>('queryHistory', { stateGroup: 'terminal', pageSize: 20 })).total, 2)
    assert.equal((await core.call<any>('queryHistory', { stateGroup: 'terminal', state: 'running' })).total, 0)
    console.log('PASS: native persistent operation pagination, approval/history partition and scoped filter metadata')
    await core.call('clearOperationOutput',operation.id)
    assert.equal(unpack(await client.callTool({name:'read_output',arguments:{id:operation.id,cursor:0}})).chunks.length,0)
    assert.equal(unpack(await client.callTool({name:'start_command',arguments:{serverId:commandTarget.id,requestKey:'native-smoke',cwd:'/native-fixture',command:'synthetic command'}})).id,operation.id)
    await core.call('deleteOperation',operation.id)
    const removed=unpack(await client.callTool({name:'start_command',arguments:{serverId:commandTarget.id,requestKey:'native-smoke',cwd:'/native-fixture',command:'synthetic command'}}))
    assert.equal(removed.error.code,'OPERATION_REMOVED');assert.equal(fixture.sessions,2)
    await core.call('reclaimRecordingSpace')
    console.log('PASS: history filters, approval timestamp, output cleanup, deletion deduplication and database reclaim')
    const currentPolicy = await core.call<any>('getApprovalPolicy')
    const rule = { id: randomUUID(), name: 'native exact rule', enabled: true, action: 'allow', command: 'synthetic command', cwd: '/native-fixture', profileIds: [access.profile.id], serverIds: [commandTarget.id], expiresAt: null }
    const savedPolicy = await core.call<any>('saveApprovalPolicy', { ...currentPolicy, mode: 'rules', rules: [rule] })
    const preview = await core.call<any>('previewApprovalPolicy', { profileId: access.profile.id, serverId: commandTarget.id, command: 'synthetic command', cwd: '/native-fixture' })
    assert.equal(preview.action, 'allow'); assert.equal(fixture.sessions, 2)
    const riskPreview = await core.call<any>('previewApprovalPolicy', { profileId: access.profile.id, serverId: commandTarget.id, command: 'rm synthetic-file', cwd: '/native-fixture' })
    assert.equal(riskPreview.action, 'approval'); assert.ok(riskPreview.matchedRules.some((r: any) => r.risk === 'high')); assert.equal(fixture.sessions, 2)
    const allowed = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-rule', cwd: '/native-fixture', command: 'synthetic command' } })) as Operation
    assert.equal(allowed.decision?.action, 'allow')
    for (let attempt = 0; attempt < 40; attempt++) {
      completed = unpack(await client.callTool({ name: 'get_operation', arguments: { id: allowed.id } })) as Operation
      if (completed.state === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(completed?.state, 'succeeded'); assert.equal(fixture.sessions, 3)
    await core.call('saveApprovalPolicy', { ...savedPolicy, mode: 'paused' })
    const denied = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-denied', cwd: '/native-fixture', command: 'synthetic command' } })) as Operation
    assert.equal(denied.state, 'denied'); assert.equal(fixture.sessions, 3)
    console.log('PASS: policy preview without SSH, exact auto-allow and pause rejection through MCP')
    const beforePermissive = await core.call<any>('getApprovalPolicy')
    await assert.rejects(core.call('saveApprovalPolicy', { ...beforePermissive, mode: 'permissive' }), (e: any) => e.code === 'PERMISSIVE_CONFIRMATION')
    await core.call('saveApprovalPolicy', { ...beforePermissive, mode: 'permissive', permissiveConfirmed: true })
    const permissiveCommands = [
      'uname -r; id; command -v docker dockerd podman glxinfo eglinfo lspci lsusb git node python3',
      'cat /etc/os-release; lscpu; free -h; lsblk -o NAME,PATH,SIZE',
      "export LC_ALL=C; printf '\\n[processes pid comm]\\n'; ps -eo pid,comm,args",
      "find -P '/app' -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | head -50",
      "echo 'rm is text'; grep -F 'restart' /srv/synthetic/logs/app.log",
      'custom-synthetic-program --inspect',
      'systemctl restart synthetic.service', 'curl -d synthetic http://127.0.0.1', 'python3 -c "print(1)"',
      'echo synthetic > /srv/synthetic.conf; for x in a b; do echo "$x"; done',
    ]
    for (const [index, command] of permissiveCommands.entries()) {
      const item = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: `native-permissive-${index}`, cwd: '/', command } })) as Operation
      assert.equal(item.decision?.action, 'allow'); assert.equal(item.decision?.mode, 'permissive'); assert.equal(item.decision?.queryPlan, undefined)
      for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', item.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 50)) }
      assert.equal((await core.call<Operation>('getOperation', item.id)).state, 'succeeded')
      assert.ok(unpack(await client.callTool({ name: 'read_output', arguments: { id: item.id, cursor: 0 } })).chunks.length)
    }
    const beforePermissiveRisk = fixture.sessions
    for (const [index, command] of ['id; rm /srv/synthetic/file', 'reboot', 'docker volume rm synthetic', "sh -c 'rm /srv/synthetic/file'"].entries()) {
      const item = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: `native-permissive-risk-${index}`, cwd: '/', command } })) as Operation
      assert.equal(item.state, 'awaiting_approval'); assert.equal(item.intentAt, null)
      await core.call('decideOperation', { id: item.id, approve: false })
    }
    assert.equal(fixture.sessions, beforePermissiveRisk)
    console.log('PASS: explicit permissive policy dispatches original literal batches and records output; routine writes/restarts/scripts run while destructive requests require approval without partial dispatch')

    const assisted = await core.call<any>('getApprovalPolicy')
    await core.call('saveApprovalPolicy', { ...assisted, mode: 'assisted', aiAssist: false })
    const composed = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-composable-query', cwd: '/', command: "ss -lntp; echo '--- synthetic containers ---'; docker ps --format '{{.Names}} | {{.Image}} | {{.Ports}}'; systemctl list-units --type=service --state=running --no-legend --plain" } })) as Operation
    assert.equal(composed.decision?.action, 'allow')
    assert.equal(composed.decision?.aiReview, undefined)
    assert.equal(composed.decision?.queryAnalysis?.checks.length, 4)
    assert.ok(composed.decision?.queryPlan?.command.includes('/usr/bin/ss -l -n -t -p'))
    assert.ok(composed.decision?.queryPlan?.command.includes('/usr/bin/docker ps'))
    for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', composed.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 50)) }
    assert.equal((await core.call<Operation>('getOperation', composed.id)).state, 'succeeded')
    const backgroundSettings = await core.call<any>('getMcpLockSettings')
    await core.call('saveMcpLockSettings', { ...backgroundSettings, pauseMcp: false, confirmed: true })
    const desktopSecurity = new SecurityService(new KeyStore(directory), core)
    await desktopSecurity.lockDesktop()
    const lockedDesktop = await core.call<any>('status')
    assert.equal(lockedDesktop.vault, 'locked'); assert.equal(lockedDesktop.backgroundMcp, true)
    const pendingBackground = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-background-manual', cwd: '/', command: 'synthetic unknown query' } })) as Operation
    assert.equal(pendingBackground.state, 'awaiting_approval'); assert.equal(pendingBackground.intentAt, null)
    for (const [method, payload] of [
      ['listServers', undefined], ['listCredentials', undefined], ['listProfiles', undefined],
      ['getOperation', pendingBackground.id], ['getApprovalPolicy', undefined], ['getAiSettings', undefined],
      ['installationProfile', access.profile.id], ['decideOperation', { id: pendingBackground.id, approve: true }],
      ['saveMcpLockSettings', { revision: 1, pauseMcp: true }],
    ] as const) await assert.rejects(core.call(method, payload), (e: any) => e.code === 'VAULT_LOCKED')
    const background = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-background-query', cwd: '/', command: 'ps -eo pid,comm,args' } })) as Operation
    assert.equal(background.decision?.action, 'allow')
    let backgroundDone: Operation = background
    for (let i = 0; i < 40; i++) {
      backgroundDone = unpack(await client.callTool({ name: 'get_operation', arguments: { id: background.id } })) as Operation
      if (backgroundDone.state === 'succeeded') break
      await new Promise(r => setTimeout(r, 50))
    }
    assert.equal(backgroundDone.state, 'succeeded')
    assert.ok(unpack(await client.callTool({ name: 'read_output', arguments: { id: background.id, cursor: 0 } })).chunks.length)
    await desktopSecurity.unlock(newPassword, true)
    assert.equal((await core.call<Operation>('getOperation', pendingBackground.id)).state, 'awaiting_approval')
    await core.call('decideOperation', { id: pendingBackground.id, approve: false })
    await core.call('saveMcpLockSettings', { revision: backgroundSettings.revision + 1, pauseMcp: true })
    await desktopSecurity.lockDesktop()
    assert.equal((await core.call<any>('status')).backgroundMcp, false)
    const pausedCall = unpack(await client.callTool({ name: 'list_servers', arguments: {} }))
    assert.equal(pausedCall.error.code, 'VAULT_LOCKED')
    await desktopSecurity.unlock(newPassword, true)
    console.log('PASS: background MCP executes and records with desktop locked; desktop secrets/approval/settings denied, default pause restored')
    const textQuery = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-composable-text', cwd: '/', command: "ps aux | awk '{print $1}' | sort | uniq -c | sort -nr | head -20" } })) as Operation
    assert.equal(textQuery.decision?.action, 'allow'); assert.equal(textQuery.decision?.queryAnalysis?.checks.length, 6)
    for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', textQuery.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 50)) }
    assert.equal((await core.call<Operation>('getOperation', textQuery.id)).state, 'succeeded')
    const beforeMixed = fixture.sessions
    const mixed = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-composable-mixed', cwd: '/', command: 'ss -lntp; docker restart synthetic-container' } })) as Operation
    assert.equal(mixed.state, 'awaiting_approval'); assert.equal(mixed.intentAt, null)
    assert.ok(mixed.decision?.reason.includes('第 2 段'))
    assert.equal(fixture.sessions, beforeMixed); assert.equal(approvalAiRequests, 0)
    await core.call('decideOperation', { id: mixed.id, approve: false })
    console.log('PASS: native composable port/container/service query without AI, per-stage reasons and no partial mixed dispatch')
    await core.call('saveApplication', { serverId: commandTarget.id, revision: 0, name: 'Synthetic diagnostic logs', aliases: [], description: 'Synthetic fixture scope', environment: 'test', deploymentPath: '/custom/synthetic', runtime: 'unknown', runtimeTarget: '', logSources: [{ id: randomUUID(), name: 'literal trace', kind: 'file', target: '/custom/synthetic/runtime.trace', timezone: 'UTC' }, { id: randomUUID(), name: 'literal trace with space', kind: 'file', target: '/custom/synthetic/runtime trace', timezone: 'UTC' }] })
    for (const [index, [_category, rawCommand]] of diagnosticQueries.entries()) {
      const command = rawCommand.replaceAll('synthetic.example.invalid', 'localhost')
      const operation = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: `native-common-diagnostic-${index}`, cwd: '/data/synthetic-proxy', command } })) as Operation
      assert.equal(operation.decision?.action, 'allow', `${_category}: ${operation.decision?.reason}`)
      assert.equal(operation.decision?.aiReview, undefined)
      for (let i = 0; i < 100; i++) { if ((await core.call<Operation>('getOperation', operation.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 20)) }
      const completedDiagnostic: Operation = await core.call<Operation>('getOperation', operation.id)
      assert.equal(completedDiagnostic.state, 'succeeded'); assert.ok(completedDiagnostic.intentAt)
      assert.equal(operationApproval(completedDiagnostic).label, '自动通过')
      if (command.includes('/custom/synthetic/runtime.trace')) assert.ok(completedDiagnostic.decision?.queryPlan?.scopeRevision)
    }
    assert.equal(approvalAiRequests, 0)
    console.log(`PASS: all ${diagnosticQueries.length} common diagnostic scenarios via native Core/MCP with AI off, maintained log scope and durable automatic-approval records`)
    const systemQuery = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-assisted-system', cwd: '/', command: "echo '=== synthetic system ==='; uname -a && free -h" } })) as Operation
    assert.equal(systemQuery.decision?.action, 'allow')
    assert.ok(systemQuery.decision?.queryPlan?.command.includes('/usr/bin/uname -a'))
    for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', systemQuery.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 50)) }
    assert.equal((await core.call<Operation>('getOperation', systemQuery.id)).state, 'succeeded')
    const assistedLog = unpack(await client.callTool({ name: 'query_application_logs', arguments: { ...logOperation.context!.query, requestKey: 'native-assisted-log' } })) as Operation
    assert.equal(assistedLog.decision?.action, 'allow')
    for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', assistedLog.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 50)) }
    assert.equal((await core.call<Operation>('getOperation', assistedLog.id)).state, 'succeeded')
    await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), aiAssist: true })
    const beforeReview = fixture.sessions
    const advised = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-assisted-advice', cwd: '/', command: 'synthetic diagnostic' } })) as Operation
    for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', advised.id)).decision?.aiReview?.status === 'complete') break; await new Promise(r => setTimeout(r, 50)) }
    const advice = await core.call<Operation>('getOperation', advised.id)
    assert.equal(advice.state, 'awaiting_approval'); assert.equal(advice.intentAt, null)
    assert.equal(advice.decision?.aiReview?.recommendation, 'query')
    assert.equal(fixture.sessions, beforeReview); assert.equal(approvalAiRequests, 1)
    await core.call('decideOperation', { id: advised.id, approve: false })
    const sensitive = unpack(await client.callTool({ name: 'start_command', arguments: { serverId: commandTarget.id, requestKey: 'native-assisted-sensitive', cwd: '/', command: 'cat /etc/shadow' } })) as Operation
    for (let i = 0; i < 40; i++) { if ((await core.call<Operation>('getOperation', sensitive.id)).decision?.aiReview?.status === 'sensitive') break; await new Promise(r => setTimeout(r, 20)) }
    assert.equal((await core.call<Operation>('getOperation', sensitive.id)).decision?.aiReview?.status, 'sensitive')
    assert.equal(approvalAiRequests, 1); assert.equal(fixture.sessions, beforeReview)
    await core.call('decideOperation', { id: sensitive.id, approve: false })
    console.log('PASS: native assisted fixed queries/logs, structured AI advice without dispatch, and sensitive-input privacy fallback')
    await client.close(); client = undefined
    await core.call('stopMcp')
    console.log('PASS: utility-process MCP, explicit desktop approval, synthetic SSH command and encrypted output')
    const investigationPolicy = await core.call<any>('getApprovalPolicy')
    await core.call('saveApprovalPolicy', { ...investigationPolicy, mode: 'all-approval' })
    await core.call('startInvestigation', { serverId: commandTarget.id, serverRevision: commandTarget.revision, aiRevision: 2 })
    let dossier: InvestigationView | undefined
    for (let i = 0; i < 150; i++) {
      dossier = await core.call<InvestigationView>('getServerDossier', commandTarget.id)
      if (!isInvestigating(dossier.run)) break
      if (dossier.run?.operationId) {
        const op = await core.call<Operation>('getOperation', dossier.run.operationId)
        if (op.state === 'awaiting_approval') await core.call('decideOperation', { id: op.id, approve: true })
      }
      await new Promise(r => setTimeout(r, 50))
    }
    assert.equal(dossier?.run?.state, 'completed'); assert.equal(dossier.report?.content.applications[0].name, 'Fixture Web')
    const restartLockSettings = await core.call<any>('getMcpLockSettings')
    await core.call('saveMcpLockSettings', { ...restartLockSettings, pauseMcp: false, confirmed: true })
    await core.call('lockDesktop')
    assert.equal((await core.call<any>('status')).backgroundMcp, true)
    await core.stopAndWait()
    core = new CoreClient(directory, join(process.cwd(), 'out/main/core.cjs'), 0)
    assert.equal((await core.call<any>('getMcpLockSettings')).pauseMcp, false)
    assert.equal((await core.call<any>('status')).backgroundMcp, false)
    await assert.rejects(core.call('getServerDossier', commandTarget.id))
    await new SecurityService(new KeyStore(directory), core).unlock(newPassword)
    await core.call('saveMcpLockSettings', { revision: restartLockSettings.revision + 1, pauseMcp: true })
    console.log('PASS: opt-out persists across Core restart without unlocking credentials')
    const restoredDossier = await core.call<InvestigationView>('getServerDossier', commandTarget.id)
    assert.equal(restoredDossier.report?.runId, dossier.report?.runId)
    console.log('PASS: desktop AI investigation, per-query approval, Anthropic structured report and encrypted restart persistence')
    const manualContent = structuredClone(restoredDossier.report!.content); manualContent.system.cpu.value = 'Native manual CPU'
    await core.call('editServerDossier', { serverId: commandTarget.id, runId: restoredDossier.report!.runId, revision: 0, content: manualContent })
    await core.stopAndWait(); core = new CoreClient(directory, join(process.cwd(), 'out/main/core.cjs'), 0)
    await assert.rejects(core.call('getServerDossier', commandTarget.id))
    await new SecurityService(new KeyStore(directory), core).unlock(newPassword)
    const manualRestored = await core.call<InvestigationView>('getServerDossier', commandTarget.id)
    assert.equal(manualRestored.report?.content.system.cpu.value, 'Native manual CPU')
    assert.deepEqual(manualRestored.report?.manualFields, ['system.cpu'])
    assert.deepEqual(manualRestored.report?.content.system.cpu.evidenceIds, [])
    assert.equal((await core.call<any[]>('listProfiles')).find(p => p.id === access.profile.id).expiresAt, null)
    const resumed = await core.call<{ url: string }>('startMcp')
    const resumedClient = new Client({ name: 'permanent restart fixture', version: '1' })
    await resumedClient.connect(new StreamableHTTPClientTransport(new URL(resumed.url), { requestInit: { headers: { Authorization: `Bearer ${access.token}` } } }))
    try { assert.equal(unpack(await resumedClient.callTool({ name: 'list_servers', arguments: {} }))[0].id, commandTarget.id) } finally { await resumedClient.close() }
    const profileBeforeEdit = (await core.call<any[]>('listProfiles')).find(p => p.id === access.profile.id)
    await core.call('updateProfile', { id: profileBeforeEdit.id, revision: profileBeforeEdit.revision, name: 'edited native fixture', serverIds: profileBeforeEdit.serverIds, expiresAt: Date.now() + 7 * 86400000 })
    await copyMcpInstallation(core, () => 0, access.profile.id, text => clipboard.writeText(text))
    const installation = JSON.parse(await clipboard.readText()).mcpServers.hostharbor
    assert.equal(installation.url, resumed.url)
    assert.equal(installation.headers.Authorization, `Bearer ${access.token}`)
    const installedClient = new Client({ name: 'copied installation fixture', version: '1' })
    await installedClient.connect(new StreamableHTTPClientTransport(new URL(installation.url), { requestInit: { headers: installation.headers } }))
    try { assert.equal(unpack(await installedClient.callTool({ name: 'list_servers', arguments: {} }))[0].id, commandTarget.id) } finally { await installedClient.close() }
    let lockRace = 0, copiedDuringLock = false
    await assert.rejects(copyMcpInstallation(core, () => lockRace++, access.profile.id, () => { copiedDuringLock = true }))
    assert.equal(copiedDuringLock, false)
    await core.call('lock')
    await assert.rejects(copyMcpInstallation(core, () => 0, access.profile.id, () => { copiedDuringLock = true }))
    assert.equal(copiedDuringLock, false)
    await new SecurityService(new KeyStore(directory), core).unlock(newPassword)
    console.log('PASS: encrypted profile Token survives native restart; grant edit and Main clipboard export respect lock/revision')
    await clipboard.clear()
    await core.call('revokeProfile', access.profile.id)
    const revokedResponse = await fetch(resumed.url, { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    assert.equal(revokedResponse.status, 401)
    const currentRevoked = (await core.call<any>('queryProfiles', { status: 'revoked', query: 'edited native fixture' })).profiles[0]
    await core.call('deleteProfile', { id: access.profile.id, revision: currentRevoked.revision })
    const deletedAccess = await core.call<any>('queryProfiles', { status: 'deleted', query: 'edited native fixture', pageSize: 20 })
    assert.equal(deletedAccess.total, 1); assert.equal(deletedAccess.profiles[0].hasSavedToken, false)
    assert.equal((await core.call<any[]>('listProfiles')).some(p => p.id === access.profile.id), false)
    await assert.rejects(core.call('installationProfile', access.profile.id))
    console.log('PASS: native access pagination/delete preserves a tombstone and rejects token export')
    console.log('PASS: permanent MCP profile executes with approval, survives Core restart and rejects after revocation')
    console.log('PASS: manual dossier corrections survive native Core lock/restart without reusing machine evidence')
    let denyNativeUpload = false
    nativeFiles = await sftpFixture({ denyOpen: () => denyNativeUpload })
    const nativeCredential = await core.call<CredentialSummary>('saveCredential', { name: 'Synthetic SFTP credential', kind: 'password', password: 'synthetic-file-password' })
    const nativeServer = await core.call<ServerRecord>('saveServer', { name: 'Synthetic SFTP server', host: '127.0.0.1', port: nativeFiles.port, username: 'synthetic-file-user', credentialId: nativeCredential.id })
    const fileChallenge = await core.call<ConnectionTest>('testConnection', nativeServer.id)
    assert.equal(fileChallenge.status, 'host-key-required'); if (fileChallenge.status !== 'host-key-required') throw new Error('Synthetic challenge missing')
    await core.call('trustHost', fileChallenge.challengeId)
    const fileAccess = await core.call<any>('createProfile', { name: 'Synthetic SFTP client', serverIds: [nativeServer.id], mode: 'policy', expiresAt: null })
    const send = join(nativeFiles.directory, 'send'), receive = join(nativeFiles.directory, 'receive'); mkdirSync(send); mkdirSync(receive)
    const fileBytes = randomBytes(16 * 1048576 + 123); writeFileSync(join(send, 'native.bin'), fileBytes)
    const fileGrant = await core.call<any>('saveFileAccess', { profileId: fileAccess.profile.id, serverId: nativeServer.id, revision: 0, uploadEnabled: true, uploadDirectory: '/srv/files', maxFileSizeMiB: 32 })
    await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), mode: 'permissive', permissiveConfirmed: true, aiAssist: false })
    const fileMcp = await core.call<any>('startMcp'), fileClient = new Client({ name: 'Synthetic SFTP client', version: '1' })
    try {
      await fileClient.connect(new StreamableHTTPClientTransport(new URL(fileMcp.url), { requestInit: { headers: { Authorization: `Bearer ${fileAccess.token}` } } }))
      const description = unpack(await fileClient.callTool({ name: 'get_file_access', arguments: { serverId: nativeServer.id } }))
      assert.equal(description.uploadDirectory, '/srv/files'); assert.equal(description.maxFileSizeMiB, 32); assert.equal(description.manualTransferApproval, true); assert.equal(description.verification, 'standard'); assert.equal(description.idleTimeoutSeconds, 120); assert.equal(description.totalTimeoutMinutes, 120)
      const beforeBrowse = await core.call<any>('queryHistory', { serverId: nativeServer.id })
      const browsed = unpack(await fileClient.callTool({ name: 'list_remote_files', arguments: { serverId: nativeServer.id, remotePath: '/srv/files' } }))
      assert.ok(browsed.entries.some((e: any) => e.name === 'source.bin')); assert.equal(browsed.id, undefined)
      assert.equal((await core.call<any>('queryHistory', { serverId: nativeServer.id })).total, beforeBrowse.total)
      const uploadRequest = { serverId: nativeServer.id, requestKey: 'native-sftp-upload', localPath: join(send, 'native.bin'), remoteName: 'native.bin' }
      const upload = unpack(await fileClient.callTool({ name: 'upload_file', arguments: uploadRequest })) as Operation
      assert.equal(upload.state, 'awaiting_approval'); assert.equal(nativeFiles.writes, 0); assert.equal(upload.transfer?.sourceHash, undefined)
      await core.call('decideOperation', { id: upload.id, approve: true })
      for (let n = 0; n < 80; n++) { if ((await core.call<Operation>('getOperation', upload.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      const uploaded = await core.call<Operation>('getOperation', upload.id); assert.equal(uploaded.state, 'succeeded'); assert.equal(uploaded.fileResult?.published, true)
      assert.equal(uploaded.fileResult?.verificationComplete, true); assert.equal(uploaded.fileResult?.verification, 'standard'); assert.equal(nativeFiles.reads, 0); assert.equal(uploaded.transfer?.totalTimeoutMs, 7200000)
      assert.deepEqual(readFileSync(join(nativeFiles.remoteRoot, 'native.bin')), fileBytes)
      const download = unpack(await fileClient.callTool({ name: 'download_file', arguments: { serverId: nativeServer.id, requestKey: 'native-sftp-download', remotePath: '/srv/files/native.bin', localPath: join(receive, 'received.bin') } })) as Operation
      assert.equal(download.state, 'awaiting_approval'); await core.call('decideOperation', { id: download.id, approve: true })
      for (let n = 0; n < 80; n++) { if ((await core.call<Operation>('getOperation', download.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      assert.equal((await core.call<Operation>('getOperation', download.id)).fileResult?.sha256, uploaded.fileResult?.sha256)
      assert.deepEqual(readFileSync(join(receive, 'received.bin')), fileBytes); assert.equal(nativeFiles.execs, 0)
      await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), downloadApprovalRequired: { permissive: false } })
      const automaticSettings = unpack(await fileClient.callTool({ name: 'get_file_access', arguments: { serverId: nativeServer.id } }))
      assert.equal(automaticSettings.downloadRequiresApproval, false); assert.equal(automaticSettings.uploadRequiresApproval, true)
      const automatic = unpack(await fileClient.callTool({ name: 'download_file', arguments: { serverId: nativeServer.id, requestKey: 'native-auto-download', remotePath: '/srv/files/native.bin', localPath: join(receive, 'automatic.bin') } })) as Operation
      assert.notEqual(automatic.state, 'awaiting_approval')
      for (let n = 0; n < 100; n++) { if ((await core.call<Operation>('getOperation', automatic.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      assert.equal((await core.call<Operation>('getOperation', automatic.id)).state, 'succeeded')
      assert.deepEqual(readFileSync(join(receive, 'automatic.bin')), fileBytes)
      const fullGrant = await core.call<any>('saveFileAccess', { ...fileGrant, profileId: fileAccess.profile.id, verification: 'full', idleTimeoutSeconds: 180, totalTimeoutMinutes: 60 })
      const fullUpload = unpack(await fileClient.callTool({ name: 'upload_file', arguments: { ...uploadRequest, requestKey: 'native-full-upload', remoteName: 'full.bin' } })) as Operation
      await core.call('decideOperation', { id: fullUpload.id, approve: true })
      for (let n = 0; n < 200; n++) { if ((await core.call<Operation>('getOperation', fullUpload.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      const fullResult = await core.call<Operation>('getOperation', fullUpload.id)
      assert.equal(fullResult.state, 'succeeded'); assert.equal(fullResult.fileResult?.verifiedBytes, fileBytes.length); assert.equal(fullResult.fileResult?.sha256, uploaded.fileResult?.sha256)
      assert.equal(fullGrant.verification, 'full')
      await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), uploadApprovalRequired: { permissive: false } })
      const uploadSettings = unpack(await fileClient.callTool({ name: 'get_file_access', arguments: { serverId: nativeServer.id } }))
      assert.equal(uploadSettings.uploadRequiresApproval, false); assert.equal(uploadSettings.downloadRequiresApproval, false)
      const automaticUpload = unpack(await fileClient.callTool({ name: 'upload_file', arguments: { ...uploadRequest, requestKey: 'native-auto-upload', remoteName: 'automatic.bin' } })) as Operation
      assert.notEqual(automaticUpload.state, 'awaiting_approval')
      for (let n = 0; n < 200; n++) { if ((await core.call<Operation>('getOperation', automaticUpload.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      const autoUploaded = await core.call<Operation>('getOperation', automaticUpload.id)
      assert.equal(autoUploaded.state, 'succeeded'); assert.equal(autoUploaded.decision?.action, 'allow')
      assert.deepEqual(readFileSync(join(nativeFiles.remoteRoot, 'automatic.bin')), fileBytes)
      await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), uploadApprovalRequired: { permissive: true } })
      denyNativeUpload = true
      const refused = unpack(await fileClient.callTool({ name: 'upload_file', arguments: { ...uploadRequest, requestKey: 'native-denied-create', remoteName: 'denied.bin' } })) as Operation
      await core.call('decideOperation', { id: refused.id, approve: true })
      for (let n = 0; n < 100; n++) { if ((await core.call<Operation>('getOperation', refused.id)).state === 'failed') break; await new Promise(r => setTimeout(r, 25)) }
      const refusedResult = await core.call<Operation>('getOperation', refused.id)
      assert.equal(refusedResult.state, 'failed'); assert.equal(refusedResult.errorCode, 'FILE_PERMISSION_DENIED')
      assert.equal(refusedResult.fileResult?.stage, 'opening'); assert.equal(refusedResult.fileResult?.publicationAttempted, false)
      assert.equal(refusedResult.fileResult?.failure?.sftpStatus, 3)
      denyNativeUpload = false
      const denied = await fileClient.callTool({ name: 'upload_file', arguments: { ...uploadRequest, requestKey: 'native-outside', remoteName: '../escape.bin' } })
      assert.equal(denied.isError, true)
    } finally { await fileClient.close() }
    await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), uploadApprovalRequired: { permissive: false } })
    await core.stopAndWait(); core = new CoreClient(directory, join(process.cwd(), 'out/main/core.cjs'), 0)
    await assert.rejects(core.call('getFileAccess', { profileId: fileAccess.profile.id, serverId: nativeServer.id }))
    await new SecurityService(new KeyStore(directory), core).unlock(newPassword)
    assert.equal((await core.call<any>('getFileAccess', { profileId: fileAccess.profile.id, serverId: nativeServer.id })).revision, fileGrant.revision + 1)
    assert.equal((await core.call<any>('getFileAccess', { profileId: fileAccess.profile.id, serverId: nativeServer.id })).verification, 'full')
    assert.equal((await core.call<any>('getApprovalPolicy')).downloadApprovalRequired.permissive, false)
    assert.equal((await core.call<any>('getApprovalPolicy')).uploadApprovalRequired.permissive, false)
    assert.equal((await core.call<any>('queryProfiles', { status: 'deleted', query: 'edited native fixture' })).profiles[0].id, access.profile.id)
    console.log('PASS: native SFTP per-request local paths, fixed upload directory, configurable size, manual defaults and independent automatic upload/download opt-outs in permissive mode, binary/hash integrity and settings persistence')
    await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), mode: 'all-approval' })
    const sudoInputs: string[] = [], sudoCommands: string[] = []
    nativeSudo = await sshFixture({ exec: (command, stream) => {
      sudoCommands.push(command)
      const prompt = command.match(/HH_SUDO_[a-f0-9]{48}:/)![0], marker = [...command.matchAll(/[a-f0-9]{48}/g)].at(-1)![0]
      stream.on('data', (data: Buffer) => { sudoInputs.push(data.toString()); stream.write(`${marker}\0/synthetic/root\0`); stream.write('synthetic-native-elevation-password\n'); stream.exit(0); stream.end() })
      stream.stderr.write(prompt.slice(0, 10)); setTimeout(() => stream.stderr.write(prompt.slice(10)), 10)
    } })
    const sudoLogin = await core.call<CredentialSummary>('saveCredential', { name: 'Synthetic sudo login', kind: 'password', password: 'target-secret' })
    const sudoPassword = await core.call<CredentialSummary>('saveCredential', { name: 'Synthetic sudo password', kind: 'password', password: 'synthetic-native-elevation-password' })
    const sudoServer = await core.call<ServerRecord>('saveServer', { name: 'Synthetic sudo target', host: '127.0.0.1', port: nativeSudo.port, username: 'target-user', credentialId: sudoLogin.id, elevation: { type: 'sudo', passwordSource: 'credential', credentialId: sudoPassword.id } })
    const sudoChallenge = await core.call<ConnectionTest>('testConnection', sudoServer.id); if (sudoChallenge.status !== 'host-key-required') throw Error('Synthetic sudo challenge missing')
    await core.call('trustHost', sudoChallenge.challengeId)
    const sudoAccess = await core.call<any>('createProfile', { name: 'Synthetic sudo client', serverIds: [sudoServer.id], mode: 'policy', expiresAt: null })
    const sudoMcp = await core.call<any>('startMcp'), sudoClient = new Client({ name: 'Synthetic sudo client', version: '1' })
    try {
      await sudoClient.connect(new StreamableHTTPClientTransport(new URL(sudoMcp.url), { requestInit: { headers: { Authorization: `Bearer ${sudoAccess.token}` } } }))
      const op = unpack(await sudoClient.callTool({ name: 'start_command', arguments: { serverId: sudoServer.id, requestKey: 'native-sudo-command', command: 'id', elevation: 'sudo', cwd: '/', timeoutMs: 3000, connectTimeoutMs: 3000 } })) as Operation
      assert.equal(op.state, 'awaiting_approval'); assert.equal(sudoInputs.length, 0)
      await core.call('decideOperation', { id: op.id, approve: true })
      for (let n = 0; n < 80; n++) { if ((await core.call<Operation>('getOperation', op.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      assert.equal((await core.call<Operation>('getOperation', op.id)).state, 'succeeded'); assert.deepEqual(sudoInputs, ['synthetic-native-elevation-password\n'])
      const output = unpack(await sudoClient.callTool({ name: 'read_output', arguments: { id: op.id, cursor: 0 } }))
      assert.equal(JSON.stringify([op, output, sudoCommands]).includes('synthetic-native-elevation-password'), false)
      await core.call('saveApprovalPolicy', { ...(await core.call<any>('getApprovalPolicy')), mode: 'permissive', permissiveConfirmed: true })
      const routine = unpack(await sudoClient.callTool({ name: 'start_command', arguments: { serverId: sudoServer.id, requestKey: 'native-sudo-maintenance', command: 'systemctl restart synthetic.service', elevation: 'sudo', cwd: '/', timeoutMs: 3000, connectTimeoutMs: 3000 } })) as Operation
      assert.notEqual(routine.state, 'awaiting_approval')
      for (let n = 0; n < 100; n++) { if ((await core.call<Operation>('getOperation', routine.id)).state === 'succeeded') break; await new Promise(r => setTimeout(r, 25)) }
      assert.equal((await core.call<Operation>('getOperation', routine.id)).state, 'succeeded'); assert.equal(sudoInputs.length, 2)
      const removal = unpack(await sudoClient.callTool({ name: 'start_command', arguments: { serverId: sudoServer.id, requestKey: 'native-sudo-removal', command: 'rm /srv/synthetic', elevation: 'sudo', cwd: '/', timeoutMs: 3000, connectTimeoutMs: 3000 } })) as Operation
      assert.equal(removal.state, 'awaiting_approval'); assert.equal(sudoCommands.length, 2)
      await core.call('decideOperation', { id: removal.id, approve: false })

    } finally { await sudoClient.close() }
    await core.stopAndWait(); core = new CoreClient(directory, join(process.cwd(), 'out/main/core.cjs'), 0)
    await new SecurityService(new KeyStore(directory), core).unlock(newPassword)
    const persistedSudo = (await core.call<ServerRecord[]>('listServers')).find(s => s.id === sudoServer.id)!
    assert.deepEqual(persistedSudo.elevation, { type: 'sudo', passwordSource: 'credential', credentialId: sudoPassword.id })
    console.log('PASS: native MCP structured sudo uses bound password after policy authorization (manual or permissive maintenance), destructive sudo awaits approval, split prompt/redaction/restart persist; synthetic SSH only')
    assert.ok(Number.isFinite(powerMonitor.getSystemIdleTime()) && powerMonitor.getSystemIdleTime() >= 0)
    const idleSecurity = new SecurityService(new KeyStore(directory), core)
    let idleNow = 0, idleSample = 10000
    const idleLock = new IdleLockService(directory, core, () => idleSecurity.lockRevision, () => idleSample, () => idleSecurity.lock(), () => idleNow)
    try {
      assert.equal(idleLock.get().seconds, 1800)
      await idleLock.save({ revision: 0, seconds: 30 })
      assert.equal(new IdleLockSettingsStore(directory).get().seconds, 30)
      await idleLock.poll()
      assert.equal((await core.call<{ vault: string }>('status')).vault, 'unlocked')
      idleNow = 30001; await idleLock.poll()
      assert.equal((await core.call<{ vault: string }>('status')).vault, 'locked')
      await assert.rejects(core.call('listServers'))
      await assert.rejects(idleLock.save({ revision: 1, seconds: null }))
      await idleSecurity.unlock(newPassword); idleLock.reset()
      await idleLock.save({ revision: 1, seconds: null })
      idleNow += 1800001; idleSample = 99999; await idleLock.poll()
      assert.equal((await core.call<{ vault: string }>('status')).vault, 'unlocked')
      assert.equal(new IdleLockSettingsStore(directory).get().seconds, null)
      await idleSecurity.lock()
      assert.equal((await core.call<{ vault: string }>('status')).vault, 'locked')
    } finally { idleLock.stop() }
    console.log('PASS: native OS idle sampler, injected deadline triggers real Core lock, persisted off and manual lock remain effective')
    exitCode = 0
  } catch {
    // Never print raw exception objects: they could include secret-bearing arguments.
    console.error('FAIL: native smoke did not complete; do not treat native behavior as verified')
  } finally {
    try { await client?.close(); await core?.stopAndWait(); await fixture?.close(); await nativeFiles?.close(); await nativeSudo?.close(); if(aiFixture){aiFixture.closeAllConnections();await new Promise<void>((resolve)=>aiFixture!.close(()=>resolve()))} } catch { exitCode = 1 }
    generated?.fill(0); loaded?.fill(0)
    clearTimeout(deadline)
    app.exit(exitCode)
  }
})
