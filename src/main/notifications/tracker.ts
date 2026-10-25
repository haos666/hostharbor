import type { ApprovalReminder, ApprovalSnapshot, NotificationPreferences } from '../../shared/contracts'

export interface ReminderSink {
  badge(count: number): void
  inApp(reminder: ApprovalReminder | null): void
  system(reminder: ApprovalReminder, click: () => void): void
  closeSystem(): void
  focused(): boolean
  navigate(operationId?: string): void
}
// No Electron dependency. Only IDs/counts cross this boundary, never commands or assets.
export class ApprovalReminderTracker {
  private current: string[] = []
  private seen = new Set<string>()
  private batch = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>
  private sequence = 0
  private stopped = false
  private notificationKey = ''
  constructor(private preferences: NotificationPreferences, private readonly sink: ReminderSink, private readonly mergeMs = 1500) {}
  update(snapshot: ApprovalSnapshot): void {
    if (this.stopped) return
    const ids = snapshot.vault === 'unlocked' ? snapshot.ids : []
    const previous = this.current.join(',')
    this.current = [...new Set(ids)].slice(0, 20)
    if (previous !== this.current.join(',')) this.sink.inApp(null)
    this.sink.badge(this.preferences.badge ? this.current.length : 0)
    if (this.notificationKey && this.notificationKey !== this.current.join(',')) { this.sink.closeSystem(); this.notificationKey = '' }
    if (!this.current.length) { this.clearBatch(); this.sink.inApp(null); return }
    for (const id of this.current) if (!this.seen.has(id)) { this.seen.add(id); this.batch.add(id) }
    // Removed IDs cannot become pending again. Keep dedup memory bounded for long sessions.
    while (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value!)
    if (this.batch.size && !this.timer) this.timer = setTimeout(() => this.flush(), this.mergeMs)
  }
  configure(preferences: NotificationPreferences): void {
    this.preferences = preferences
    this.sink.badge(preferences.badge ? this.current.length : 0)
    if (!preferences.system) { this.sink.closeSystem(); this.notificationKey = '' }
  }
  unavailable(): void {
    // Drop stale badges/messages, but do not renotify the same IDs after a transient RPC failure.
    this.current = []; this.clearBatch(); this.sink.badge(0); this.sink.inApp(null); this.sink.closeSystem(); this.notificationKey = ''
  }
  private clearBatch(): void { clearTimeout(this.timer); this.timer = undefined; this.batch.clear() }
  private flush(): void {
    this.timer = undefined
    const fresh = this.current.filter(id => this.batch.has(id)); this.batch.clear()
    if (this.stopped || !fresh.length) return
    const reminder: ApprovalReminder = { sequence: ++this.sequence, count: this.current.length, operationId: this.current.length === 1 ? this.current[0] : undefined }
    this.sink.inApp(reminder)
    if (this.preferences.system && !this.sink.focused()) {
      this.sink.closeSystem(); this.notificationKey = this.current.join(',')
      this.sink.system(reminder, () => this.sink.navigate(reminder.operationId && this.current.includes(reminder.operationId) ? reminder.operationId : undefined))
    }
  }
  stop(): void { this.unavailable(); this.stopped = true }
}
