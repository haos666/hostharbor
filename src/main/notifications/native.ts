import { app, nativeImage, Notification, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ApprovalReminder, NotificationDelivery } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { msg } from '../../shared/i18n'

// Bundled image is deterministic; do not render user-controlled strings into SVG/HTML.
export function windowsApprovalBadge() {
  return nativeImage.createFromPath(join(app.getAppPath(), 'resources/branding/approval-badge.png'))
}
export function setApprovalBadge(count: number, window?: BrowserWindow | null): void {
  if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '')
  if (process.platform === 'win32' && window && !window.isDestroyed()) window.setOverlayIcon(count ? windowsApprovalBadge() : null, count ? msg('native.valueOperationsAwaitingApproval', { value0: count }) : '')
}
export class NativeApprovalNotification {
  private notification?: Notification
  private waiting?: (delivery: NotificationDelivery) => void
  lastDelivery: NotificationDelivery = 'none'
  supported(): boolean { return Notification.isSupported() }
  close(): void {
    this.waiting?.('unknown'); this.waiting = undefined
    try { this.notification?.close() } catch { /* Native notification failures must not affect approvals. */ }
    this.notification = undefined
  }
  show(reminder: ApprovalReminder | null, sound: boolean, click: () => void): Promise<NotificationDelivery> {
    if (!this.supported()) throw new AppError('NOTIFICATION_UNSUPPORTED')
    this.close(); this.lastDelivery = 'submitted'
    return new Promise(resolve => {
      let done = false
      const finish = (delivery: NotificationDelivery) => { if (done) return; done = true; clearTimeout(timer); this.waiting = undefined; this.lastDelivery = delivery; resolve(delivery) }
      const timer = setTimeout(() => finish('unknown'), 4000)
      this.waiting = finish
      try {
        const notification = new Notification({ title: reminder ? msg('native.hostharborApprovalPending') : msg('native.hostharborTestNotification'), body: reminder ? msg('native.valueOperationsAwaitApprovalClickToOpenApprovals', { value0: reminder.count }) : msg('native.thisIsATestNotificationClickToOpen'), silent: !sound, timeoutType: 'default' })
        this.notification = notification
        notification.once('show', () => finish('shown'))
        notification.once('failed', () => { if (this.notification !== notification) return; finish('failed'); this.lastDelivery = 'failed' })
        notification.once('click', click)
        notification.show()
      } catch { finish('failed') }
    })
  }
}
