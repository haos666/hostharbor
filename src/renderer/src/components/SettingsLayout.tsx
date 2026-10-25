import type { ReactNode } from 'react'
import { msg, type MessageKey } from '../../../shared/i18n'
export type SettingsPage = 'security' | 'approval' | 'recordings' | 'ai' | 'notifications' | 'language'
const groups: { label: MessageKey; pages: { id: SettingsPage; label: MessageKey }[] }[] = [
  { label: 'settings.general', pages: [{ id: 'language', label: 'language.title' }, { id: 'notifications', label: 'notificationSettings.notifications' }] },
  { label: 'settings.security', pages: [{ id: 'security', label: 'settings.vaultSecurity' }, { id: 'approval', label: 'approvalSettings.approvalPolicy' }] },
  { label: 'settings.dataAndIntegrations', pages: [{ id: 'recordings', label: 'recordingSettings.logsAndStorage' }, { id: 'ai', label: 'aiSettings.aiSettings' }] },
]
export function SettingsLayout({ active, onSelect, children }: { active: SettingsPage; onSelect: (page: SettingsPage) => void; children: ReactNode }) {
  return <div className="settings-layout"><nav className="settings-navigation" aria-label={msg('main.settingsCategories')}>{groups.map(group => <section key={group.label}><h2>{msg(group.label)}</h2>{group.pages.map(page => <button key={page.id} aria-current={active === page.id ? 'page' : undefined} onClick={() => onSelect(page.id)}>{msg(page.label)}</button>)}</section>)}</nav><div className="settings-content" key={active}>{children}</div></div>
}
