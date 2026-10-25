import { FileService } from '../files/service'
import { mcpInstructions } from '../../shared/mcp-instructions'
import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { AppError, failure } from '../../shared/errors'
import type { McpStatus } from '../../shared/contracts'
import { type OperationService } from '../operations/service'
import type { ApplicationService } from '../applications/service'
import { mcpToolDefinitions } from '../../shared/mcp-tools'

// Stateless transport; operation lifetime and identity belong to the application,
// never MCP session IDs or clientInfo supplied by the caller.
export class LocalMcpServer {
  private server: Server | undefined
  private url: string | null = null
  private starting = false
  private inFlight = 0
  constructor(readonly operations: OperationService, private readonly listenPort = 43821, private readonly applications?: ApplicationService, private readonly files = new FileService(operations)) {}
  status(): McpStatus { return { running: !!this.url, url: this.url } }
  async start(): Promise<McpStatus> {
    this.operations.servers.assertUnlocked()
    if (this.url) return this.status()
    if (this.starting) throw new AppError('MCP_FAILED')
    this.starting = true
    // Fixed port permits stable client config. No wildcard bind or fallback port.
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, (request, response) => {
      void (async () => {
        response.setHeader('Cache-Control', 'no-store')
        const host = `127.0.0.1:${(server.address() as AddressInfo).port}`
        if (request.headers.host !== host || (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`)) { response.writeHead(403).end(); return }
        if (request.url !== '/mcp') { response.writeHead(404).end(); return }
        const auth = request.headers.authorization
        let profileId: string
        try { if (!auth?.startsWith('Bearer ')) throw new AppError('ACCESS_DENIED'); profileId = this.operations.authenticate(auth.slice(7)) }
        catch { response.writeHead(401).end(); return }
        if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return }
        if (this.inFlight >= 16) { response.writeHead(429).end(); return }
        this.inFlight++
        const mcp = new McpServer({ name: 'hostharbor', version: '0.1.0' }, { instructions: mcpInstructions })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 65536 })
        const invoke = async (work: () => unknown) => {
          try {
            // Reauthenticate each tool dispatch, including revocation during body upload.
            if (this.operations.authenticate(auth!.slice(7)) !== profileId) throw new AppError('ACCESS_DENIED')
            const value = await work()
            if (this.operations.authenticate(auth!.slice(7)) !== profileId) throw new AppError('ACCESS_DENIED')
            return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
          } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(failure(error)) }] } }
        }
        mcp.registerTool('get_file_access', mcpToolDefinitions.get_file_access, ({ serverId }) => invoke(() => this.files.describe(profileId, serverId)))
        mcp.registerTool('list_remote_files', mcpToolDefinitions.list_remote_files, input => invoke(() => this.files.browse(profileId, input)))
        mcp.registerTool('upload_file', mcpToolDefinitions.upload_file, input => invoke(() => this.files.start(profileId, { ...input, direction: 'upload' })))
        mcp.registerTool('download_file', mcpToolDefinitions.download_file, input => invoke(() => this.files.start(profileId, { ...input, direction: 'download' })))
        mcp.registerTool('list_servers', mcpToolDefinitions.list_servers, ({ query }) => invoke(() => this.operations.listServers(profileId).filter(s => !query || [s.name, s.host].some(v => v.toLocaleLowerCase().includes(query.toLocaleLowerCase())))))
        if (this.applications) {
          const applications = this.applications
          mcp.registerTool('get_server_context', mcpToolDefinitions.get_server_context, ({ serverId }) => invoke(() => applications.serverContext(profileId, serverId)))
          mcp.registerTool('find_applications', mcpToolDefinitions.find_applications, input => invoke(() => applications.find(profileId, input)))
          mcp.registerTool('query_application_logs', mcpToolDefinitions.query_application_logs, input => invoke(() => applications.queryLogs(profileId, input)))
        }
        mcp.registerTool('start_command', mcpToolDefinitions.start_command, (input) => invoke(() => this.operations.start(profileId, input)))
        mcp.registerTool('get_operation', mcpToolDefinitions.get_operation, ({ id }) => invoke(() => this.operations.get(id, profileId)))
        mcp.registerTool('read_output', mcpToolDefinitions.read_output, ({ id, cursor }) => invoke(() => this.operations.read(id, cursor, profileId)))
        mcp.registerTool('cancel_operation', mcpToolDefinitions.cancel_operation, ({ id }) => invoke(() => this.operations.cancel(id, profileId)))
        let cleaned = false
        const cleanup = () => { if (cleaned) return; cleaned = true; this.inFlight--; void transport.close().catch(() => {}); void mcp.close().catch(() => {}) }
        response.once('close', cleanup)
        try { await mcp.connect(transport); await transport.handleRequest(request, response) }
        catch { if (!response.headersSent) response.writeHead(500).end(); else response.end() }
        finally { if (response.writableEnded) cleanup() }
      })().catch(() => { if (!response.headersSent) response.writeHead(500).end(); else response.end() })
    })
    server.maxConnections = 32
    server.on('error', () => { if (this.server === server) { this.url = null; this.server = undefined; server.closeAllConnections(); server.close() } })
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.listenPort, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
      this.server = server; this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
      return this.status()
    } catch { server.close(); throw new AppError('MCP_FAILED') }
    finally { this.starting = false }
  }
  async stop(): Promise<void> {
    const server = this.server; this.server = undefined; this.url = null
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
  }
}
