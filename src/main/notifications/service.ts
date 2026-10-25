import type { BrowserWindow } from 'electron'
import type { ApprovalNavigation, ApprovalSnapshot, NotificationPreferences, NotificationSettingsState } from '../../shared/contracts'
import type { CoreClient } from '../core-client'
import type { createBrandTray } from '../branding'
import { NotificationSettingsStore } from './settings'
import { ApprovalReminderTracker } from './tracker'
import { NativeApprovalNotification, setApprovalBadge } from './native'

export class DesktopApprovalNotifications {
  readonly native = new NativeApprovalNotification()
  readonly settings: NotificationSettingsStore
  readonly tracker: ApprovalReminderTracker
  private timer?: ReturnType<typeof setInterval>
  private polling = false
  private stopped = false
  private navigation: ApprovalNavigation | null = null
  private sequence = 0
  private count = -1
  constructor(directory: string, private readonly core: Pick<CoreClient, 'call'>, private readonly window: () => BrowserWindow | null, private readonly tray: () => ReturnType<typeof createBrandTray> | undefined, private readonly lockRevision: () => number, private readonly show: () => void) {
    this.settings = new NotificationSettingsStore(directory)
    // A corrupt preference file must not silently re-enable notifications.
    let preferences: NotificationPreferences = { revision: 0, badge: false, system: false, sound: false }
    try { preferences = this.settings.get() } catch { /* Settings page reports read failure. */ }
    this.tracker = new ApprovalReminderTracker(preferences, {
      badge: count => { if (count !== this.count) { this.count = count; this.refreshBadge() } },
      inApp: reminder => { try { const win = this.window(); if (win && !win.isDestroyed()) win.webContents.send('approvals:reminder', reminder) } catch { /* Closing renderers cannot block reminders or approvals. */ } },
      system: (reminder, click) => { try { void this.native.show(reminder, this.settings.get().sound, click).catch(() => {}) } catch { /* No raw OS error or asset content is logged. */ } },
      closeSystem: () => this.native.close(),
      focused: () => !!this.window()?.isFocused(),
      navigate: id => this.open(id),
    })
  }
  refreshBadge(): void {
    try { setApprovalBadge(Math.max(0, this.count), this.window()) } catch { /* Sidebar/tray remain available if OS badging fails. */ }
    try { this.tray()?.setApprovalCount(Math.max(0, this.count)) } catch { /* A missing tray does not affect execution. */ }
  }
  start(): void { void this.poll(); this.timer = setInterval(() => void this.poll(), 1000) }
  async poll(): Promise<void> {
    if (this.polling || this.stopped) return
    this.polling = true
    const revision = this.lockRevision()
    try {
      const snapshot = await this.core.call<ApprovalSnapshot>('approvalSnapshot')
      if (this.stopped) return
      if (revision !== this.lockRevision()) { this.tracker.unavailable(); return }
      this.tracker.update(snapshot)
    } catch { if (!this.stopped) this.tracker.unavailable() }
    finally { this.polling = false }
  }
  locked(): void { this.tracker.unavailable() }
  getSettings(): NotificationSettingsState {
    const preferences = this.settings.get()
    this.tracker.configure(preferences)
    return { preferences, supported: this.native.supported(), delivery: this.native.lastDelivery }
  }
  saveSettings(raw: unknown): NotificationSettingsState {
    const next = this.settings.save(raw)
    this.tracker.configure(next)
    return this.getSettings()
  }
  test() { return this.native.show(null, this.settings.get().sound, () => this.open()) }
  open(operationId?: string): void {
    if (this.stopped) return
    this.navigation = { sequence: ++this.sequence, operationId }
    this.show()
    try { const win = this.window(); if (win && !win.isDestroyed()) win.webContents.send('approvals:navigation') } catch { /* Retain the navigation for the next renderer mount. */ }
  }
  takeNavigation(): ApprovalNavigation | null { const navigation = this.navigation; this.navigation = null; return navigation }
  stop(): void { this.stopped = true; clearInterval(this.timer); this.tracker.stop(); this.native.close(); this.navigation = null }
}
