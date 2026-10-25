import { DesktopApprovalNotifications } from './notifications/service'
import { IdleLockService } from './idle-lock'
import { copyMcpInstallation } from './mcp-installation'
import { app, BrowserWindow, clipboard, ipcMain, powerMonitor, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppStatus } from '../shared/contracts'
import { AppError, failure } from '../shared/errors'
import { CoreClient } from './core-client'
import { applicationIcon, createBrandTray } from './branding'
import { KeyStore } from './key-store'
import { SecurityService } from '../core/security/service'
import { LanguageSettingsStore } from './language-settings'
import { getLocale, msg, resolveLanguage, setLocale, type LanguageSettings } from '../shared/i18n'

let window: BrowserWindow | null = null
let core: CoreClient
let keys: KeyStore
let quitting = false
let security: SecurityService
let approvalNotifications: DesktopApprovalNotifications | undefined
let statusIcon: ReturnType<typeof createBrandTray> | undefined
let idleLock: IdleLockService | undefined
async function lockVault(): Promise<void> {
  idleLock?.reset(); approvalNotifications?.locked()
  const pending = security.lockDesktop()
  if (window && !window.isDestroyed()) window.webContents.send('vault:locked')
  await pending
}
function createWindow(): void {
  window = new BrowserWindow({
    width: 1240, height: 840, minWidth: 960, minHeight: 650,
    backgroundColor: '#101619', title: process.platform === 'darwin' ? '' : 'HostHarbor', icon: applicationIcon(),
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  })
  // Keep the macOS native title bar blank even when the document supplies a title.
  if (process.platform === 'darwin') window.on('page-title-updated', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.on('focus', () => approvalNotifications?.refreshBadge())
  window.webContents.once('did-finish-load', () => approvalNotifications?.refreshBadge())
  window.on('closed', () => { window = null; void lockVault().catch(() => {}) })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}
function showWindow(): void {
  if (quitting || !app.isReady()) return
  if (!window) createWindow()
  if (window?.isMinimized()) window.restore()
  window?.show(); window?.focus()
}
function assertSender(event: Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new AppError('INVALID_INPUT')
}
if (process.platform === 'win32') app.setAppUserModelId('com.hostharbor.desktop')
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWindow)
  void app.whenReady().then(() => {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const language = new LanguageSettingsStore(directory)
    const syncLanguage = (notify = false): LanguageSettings => {
      const preference = language.get()
      const locale = resolveLanguage(preference, app.getPreferredSystemLanguages())
      const changed = getLocale() !== locale
      setLocale(locale)
      try { statusIcon?.refreshLanguage() } catch {}
      approvalNotifications?.refreshBadge()
      const settings = { preference, locale }
      if ((notify || changed) && window && !window.isDestroyed()) window.webContents.send('language:changed', settings)
      return settings
    }
    try { syncLanguage() } catch { setLocale(resolveLanguage('system', app.getPreferredSystemLanguages())) }
    app.on('browser-window-focus', () => { try { syncLanguage() } catch {} })
    keys = new KeyStore(directory)
    core = new CoreClient(directory)
    security = new SecurityService(keys, core)
    idleLock = new IdleLockService(directory, core, () => security.lockRevision, () => powerMonitor.getSystemIdleTime(), lockVault)
    ipcMain.handle('app:get-status', async (event): Promise<AppStatus> => {
      assertSender(event)
      const revision = security.lockRevision
      const state = await core.call<{ vault: AppStatus['vault']; mcp: { running: boolean }; pendingApprovals: number; backgroundMcp: boolean }>('status')
      return { backgroundMcp: state.backgroundMcp, pendingApprovals: state.pendingApprovals, version: app.getVersion(), core: core.state, vault: revision !== security.lockRevision ? 'locked' : state.vault === 'not-configured' && keys.mode !== 'not-configured' ? 'locked' : state.vault, lockRevision: security.lockRevision, security: keys.mode, mcp: state.mcp.running ? 'running' : 'stopped' }
    })
    const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
      'language:get': async () => syncLanguage(),
      'language:save': async payload => {
        language.save(payload)
        return syncLanguage(true)
      },
      'files:browse': p => core.call('browseFiles', p),
      'files:workspace': p => core.call('fileWorkspace', p),
      'files:access': p => core.call('getFileAccess', p),
      'files:save-access': p => core.call('saveFileAccess', p),
      'files:start': p => core.call('startFileTransfer', p),
      'mcp-lock:get': () => core.call('getMcpLockSettings'),
      'mcp-lock:save': payload => core.call('saveMcpLockSettings', payload),
      'idle-lock:get': async () => idleLock!.get(),
      'idle-lock:save': payload => idleLock!.save(payload),
      'notifications:get': async () => approvalNotifications!.getSettings(),
      'notifications:save': async payload => approvalNotifications!.saveSettings(payload),
      'notifications:test': async () => approvalNotifications!.test(),
      'approvals:take-navigation': async () => approvalNotifications!.takeNavigation(),
      'mcp:copy-token': async (payload) => {
        if (typeof payload !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload)) throw new AppError('INVALID_INPUT')
        const revision = security.lockRevision
        const state = await core.call<{ vault: AppStatus['vault'] }>('status')
        if (state.vault !== 'unlocked' || revision !== security.lockRevision) throw new AppError('VAULT_LOCKED')
        await clipboard.writeText(payload)
      },
      'mcp:copy-installation': payload => copyMcpInstallation(core, () => security.lockRevision, payload, text => clipboard.writeText(text)),
      'profiles:query': payload => core.call('queryProfiles', payload),
      'profiles:delete': payload => core.call('deleteProfile', payload),
      'profiles:update': payload => core.call('updateProfile', payload),
      'profiles:token': payload => core.call('prepareProfileToken', payload),
      'profiles:list': () => core.call('listProfiles'), 'profiles:create': (payload) => core.call('createProfile', payload),
      'profiles:revoke': (payload) => core.call('revokeProfile', payload), 'mcp:status': () => core.call('mcpStatus'),
      'mcp:start': () => core.call('startMcp'), 'mcp:stop': () => core.call('stopMcp'),
      'applications:list': p => core.call('listApplications', p), 'applications:save': p => core.call('saveApplication', p),
      'applications:delete': p => core.call('deleteApplication', p),
      'dossier:edit': p => core.call('editServerDossier', p),
      'dossier:get': (p) => core.call('getServerDossier', p), 'dossier:start': (p) => core.call('startInvestigation', p),
      'dossier:cancel': (p) => core.call('cancelInvestigation', p),
      'ai:probe': (p) => core.call('testAiTools', p),
      'ai:get': () => core.call('getAiSettings'), 'ai:save': (p) => core.call('saveAiProvider', p),
      'ai:remove': (p) => core.call('removeAiProvider', p), 'ai:models': (p) => core.call('listAiModels', p),
      'history:query': (p) => core.call('queryHistory', p), 'history:get': (p) => core.call('getOperation', p),
      'recordings:status': () => core.call('getRecordingStorage'), 'recordings:settings': (p) => core.call('saveRecordingSettings', p),
      'recordings:clean': () => core.call('cleanRecordings'), 'recordings:clear': (p) => core.call('clearOperationOutput', p),
      'history:delete': (p) => core.call('deleteOperation', p), 'recordings:reclaim': () => core.call('reclaimRecordingSpace'),
      'policy:get': () => core.call('getApprovalPolicy'), 'policy:save': (payload) => core.call('saveApprovalPolicy', payload),
      'policy:preview': (payload) => core.call('previewApprovalPolicy', payload),
      'operations:list': () => core.call('listOperations'), 'operations:decide': (payload) => core.call('decideOperation', payload),
      'operations:cancel': (payload) => core.call('cancelOperation', payload), 'operations:output': (payload) => core.call('readOperationOutput', payload),
      'security:setup': (payload) => security.setup(payload), 'vault:unlock': async (payload) => { idleLock?.reset(); await security.unlock(payload, true); idleLock?.reset() },
      'security:password': (payload) => security.changePassword(payload), 'security:reset': (payload) => security.resetPassword(payload),
      'security:recovery': (payload) => security.changeRecovery(payload), 'vault:lock': () => lockVault(),
      'servers:list': () => core.call('listServers'), 'servers:save': (payload) => core.call('saveServer', payload),
      'servers:delete': (payload) => core.call('deleteServer', payload),
      'credentials:list': () => core.call('listCredentials'), 'credentials:save': (payload) => core.call('saveCredential', payload),
      'credentials:delete': (payload) => core.call('deleteCredential', payload),
      'servers:test': (payload) => core.call('testConnection', payload), 'hosts:trust': (payload) => core.call('trustHost', payload),
    }
    for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, async (event, payload: unknown) => {
      try {
        assertSender(event)
        const revision = security.lockRevision
        const value = await handler(payload)
        if (revision !== security.lockRevision && !channel.startsWith('security:') && !channel.startsWith('language:') && channel !== 'vault:lock') throw new AppError('VAULT_LOCKED')
        return { ok: true, value }
      }
      catch (error) { return failure(error) }
    })
    powerMonitor.on('lock-screen', () => { void lockVault().catch(() => {}) })
    powerMonitor.on('suspend', () => { void lockVault().catch(() => {}) })
    if (process.platform === 'darwin') app.dock?.setIcon(applicationIcon())
    createWindow()
    try {
      statusIcon = createBrandTray({
        show: showWindow,
        approvals: () => approvalNotifications?.open(),
        lock: () => { void lockVault().catch(() => { void dialog.showMessageBox({ type: 'error', title: 'HostHarbor', message: msg('index.lockIncompleteOpenTheWindowAndRetry') }) }) },
        quit: () => app.quit(),
      })
    } catch { console.warn('HostHarbor status icon unavailable') }
    approvalNotifications = new DesktopApprovalNotifications(directory, core, () => window, () => statusIcon, () => security.lockRevision, showWindow)
    approvalNotifications.start()
    idleLock.start()
    app.on('activate', showWindow)
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => { quitting = true; idleLock?.stop(); approvalNotifications?.stop(); statusIcon?.tray.destroy(); statusIcon = undefined; core?.stop() })
}
