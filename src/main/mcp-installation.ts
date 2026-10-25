import type { CoreClient } from './core-client'
import type { AppStatus } from '../shared/contracts'
import { AppError } from '../shared/errors'

// Secrets travel only Core → Main → OS clipboard, never back to the renderer.
export async function copyMcpInstallation(core: Pick<CoreClient, 'call'>, lockRevision: () => number, id: unknown, writeText: (text: string) => void | Promise<void>): Promise<void> {
  const revision = lockRevision()
  const access = await core.call<{ name: string; token: string }>('installationProfile', id)
  const state = await core.call<{ vault: AppStatus['vault']; mcp: { url: string | null } }>('status')
  if (state.vault !== 'unlocked' || revision !== lockRevision()) throw new AppError('VAULT_LOCKED')
  await writeText(JSON.stringify({ mcpServers: { hostharbor: { type: 'http', url: state.mcp.url ?? 'http://127.0.0.1:43821/mcp', headers: { Authorization: `Bearer ${access.token}` } } } }, null, 2))
}
