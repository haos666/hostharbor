import { FileService } from './files/service'
import { DesktopSession, desktopPublicMethods } from './security/desktop-session'
import { join } from 'node:path'
import { ServerService } from './servers/service'
import { ApplicationService } from './applications/service'
import { InvestigationService } from './investigation/service'
import { AiService } from './ai/service'
import { OperationService } from './operations/service'
import { LocalMcpServer } from './mcp/server'
import { idSchema, parse } from './validation'
import { z } from 'zod'
import { Store } from './storage/database'
import { AppError, failure } from '../shared/errors'

const port = process.parentPort
if (!port || !process.argv[2]) throw new Error('Core requires a parent and data directory')
const service = new ServerService(new Store(join(process.argv[2], 'hostharbor.sqlite')))
const desktop = new DesktopSession(process.argv[2], service)
const ai = new AiService(service)
const operations = new OperationService(service, ai)
const files = new FileService(operations)
const investigations = new InvestigationService(operations, ai)
const applications = new ApplicationService(operations, investigations)
const mcpPort = process.argv[3] === undefined ? 43821 : Number(process.argv[3])
if (!Number.isInteger(mcpPort) || mcpPort < 0 || mcpPort > 65535) throw new AppError('INVALID_INPUT')
const mcp = new LocalMcpServer(operations, mcpPort, applications, files)
port.on('message', (event) => {
  const message = event.data as { id?: unknown; method?: unknown; payload?: unknown }
  if (typeof message?.id !== 'number' || typeof message.method !== 'string') return
  const revision = desktop.revision
  void dispatch(message.method, message.payload).then(
    (value) => {
      try {
        if (!desktopPublicMethods.has(message.method as string)) desktop.assertRevision(revision)
        port.postMessage({ type: 'result', id: message.id, result: { ok: true, value } })
      } catch (error) { port.postMessage({ type: 'result', id: message.id, result: failure(error) }) }
    },
    (error: unknown) => port.postMessage({ type: 'result', id: message.id, result: failure(error) }),
  )
})
async function dispatch(method: string, payload: unknown): Promise<unknown> {
  if (!desktopPublicMethods.has(method)) desktop.assertOpen()
  switch (method) {
    case 'browseFiles': { const i = parse(z.object({ profileId: idSchema, request: z.unknown() }).strict(), payload); const revision = desktop.revision; return files.browse(i.profileId, i.request, () => desktop.assertRevision(revision)) }
    case 'fileWorkspace': return files.workspace(payload)
    case 'getFileAccess': { const i = parse(z.object({ profileId: idSchema, serverId: idSchema }).strict(), payload); return files.access(i.profileId, i.serverId) }
    case 'saveFileAccess': return files.save(payload)
    case 'startFileTransfer': { const i = parse(z.object({ profileId: idSchema, request: z.unknown() }).strict(), payload); const revision = desktop.revision; return files.start(i.profileId, i.request, () => desktop.assertRevision(revision)) }
    case 'getMcpLockSettings': return desktop.get()
    case 'saveMcpLockSettings': return desktop.save(payload)
    case 'lockDesktop': return desktop.lock()
    case 'listApplications': return applications.list(payload)
    case 'saveApplication': return applications.save(payload)
    case 'deleteApplication': return applications.remove(payload)
    case 'editServerDossier': return investigations.edit(payload)
    case 'getServerDossier': return investigations.get(payload)
    case 'startInvestigation': return investigations.start(payload)
    case 'cancelInvestigation': return investigations.cancel(payload)
    case 'testAiTools': return ai.probe(payload)
    case 'getAiSettings': return ai.get()
    case 'saveAiProvider': return ai.save(payload)
    case 'removeAiProvider': return ai.remove(payload)
    case 'listAiModels': return ai.models(payload)
    case 'queryHistory': return operations.history(payload)
    case 'getOperation': return operations.get(parse(idSchema, payload))
    case 'getRecordingStorage': return operations.recordings.stats()
    case 'saveRecordingSettings': return operations.recordings.save(payload)
    case 'cleanRecordings': operations.recordings.maintain(); return operations.recordings.stats()
    case 'clearOperationOutput': return operations.recordings.clearOutput(parse(idSchema, payload))
    case 'deleteOperation': return operations.deleteRecord(payload)
    case 'reclaimRecordingSpace': return operations.recordings.reclaim()
    case 'getApprovalPolicy': return operations.policy.get()
    case 'saveApprovalPolicy': return operations.policy.save(payload)
    case 'previewApprovalPolicy': return operations.previewPolicy(payload)
    case 'queryProfiles': return operations.queryProfiles(payload)
    case 'deleteProfile': return operations.deleteProfile(payload)
    case 'listProfiles': return operations.listProfiles()
    case 'createProfile': return operations.createProfile(payload)
    case 'updateProfile': return operations.updateProfile(payload)
    case 'prepareProfileToken': return operations.prepareProfileToken(payload)
    case 'installationProfile': return operations.installationProfile(payload)
    case 'revokeProfile': return operations.revokeProfile(payload)
    case 'mcpStatus': return mcp.status()
    case 'startMcp': return mcp.start()
    case 'stopMcp': return mcp.stop()
    case 'listOperations': return operations.list()
    case 'decideOperation': return operations.decide(payload)
    case 'cancelOperation': return operations.cancel(parse(idSchema, payload))
    case 'readOperationOutput': { const input = parse(z.object({ id: idSchema, cursor: z.number().int().min(0) }).strict(), payload); return operations.read(input.id, input.cursor) }
    case 'approvalSnapshot': return { vault: service.vaultState, ids: operations.pendingIds() }
    case 'status': return { vault: desktop.vaultState, backgroundMcp: desktop.backgroundMcp, mcp: mcp.status(), pendingApprovals: operations.pendingCount() }
    case 'validateKey':
    case 'unlock':
    case 'unlockDesktop': {
      if (!(payload instanceof Uint8Array)) throw new AppError('KEY_UNAVAILABLE')
      const key = Buffer.from(payload)
      try { if (method === 'validateKey') service.validateKey(key); else { desktop.unlock(key, method === 'unlockDesktop'); try { operations.recordings.maintain() } catch (error) { desktop.lock(true); throw error } } } finally { key.fill(0); payload.fill(0) }
      return
    }
    case 'lock': return desktop.lock(true)
    case 'listServers': return service.listServers()
    case 'saveServer': return service.saveServer(payload)
    case 'deleteServer': return service.deleteServer(payload)
    case 'listCredentials': return service.listCredentials()
    case 'saveCredential': return service.saveCredential(payload)
    case 'deleteCredential': return service.deleteCredential(payload)
    case 'testConnection': return service.testConnection(payload)
    case 'trustHost': return service.trustHost(payload)
    default: throw new AppError('INVALID_INPUT')
  }
}
process.on('exit', () => { investigations.close(); ai.close(); operations.close(); void mcp.stop(); service.close() })
port.postMessage({ type: 'core-ready', protocolVersion: 1 })
