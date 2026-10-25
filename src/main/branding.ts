import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { msg } from '../shared/i18n'

export const brandingDirectory = () => join(app.getAppPath(), 'resources/branding')
export function applicationIcon(directory = brandingDirectory()) {
  const icon = nativeImage.createFromPath(join(directory, 'icon.png'))
  if (icon.isEmpty()) throw new Error('Application icon resource missing')
  return icon
}
export function createBrandTray(actions: { show: () => void; lock: () => void; quit: () => void; approvals?: () => void }, directory = brandingDirectory()) {
  const icon = nativeImage.createFromPath(join(directory, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'))
  if (icon.isEmpty()) throw new Error('Status icon resource missing')
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip('HostHarbor')
  const menu = Menu.buildFromTemplate([
    { id: 'open', label: msg('branding.openHostharbor'), click: actions.show },
    { id: 'approvals', label: msg('agentWorkspace.approvals'), click: actions.approvals ?? actions.show },
    { id: 'lock', label: msg('branding.lockApp'), click: actions.lock },
    { type: 'separator' },
    { id: 'quit', label: msg('branding.quitHostharbor'), click: actions.quit },
  ])
  tray.setContextMenu(menu)
  if (process.platform !== 'darwin') tray.on('click', actions.show)
  tray.on('double-click', actions.show)
  let approvalCount = 0
  const setApprovalCount = (count: number) => {
    approvalCount = count
    menu.getMenuItemById('approvals')!.label = count ? msg('branding.approvalsValuePending', { value0: count }) : msg('agentWorkspace.approvals')
    tray.setContextMenu(menu)
    tray.setToolTip(count ? msg('branding.hostharborValuePendingApprovals', { value0: count }) : 'HostHarbor')
    if (process.platform === 'darwin') tray.setTitle(count ? String(count) : '')
  }
  const refreshLanguage = () => {
    menu.getMenuItemById('open')!.label = msg('branding.openHostharbor')
    menu.getMenuItemById('lock')!.label = msg('branding.lockApp')
    menu.getMenuItemById('quit')!.label = msg('branding.quitHostharbor')
    setApprovalCount(approvalCount)
  }
  return { tray, menu, setApprovalCount, refreshLanguage }
}
