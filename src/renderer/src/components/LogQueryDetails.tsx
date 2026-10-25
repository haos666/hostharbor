import { msg } from '../../../shared/i18n'
import type { Operation } from '../../../shared/contracts'
export function LogQueryDetails({ operation }: { operation: Operation }) {
  const context = operation.context
  if (!context) return null
  return <section className="dossier-partial"><h3>{msg('logQueryDetails.applicationLogs')} {context.applicationName}</h3><p>{context.source.name} · <code>{context.source.target}</code> {msg('logQueryDetails.dossierV')}{context.query.applicationRevision}</p><p>{context.timeWindowApplied ? msg('logQueryDetails.valueToValue', { value0: context.query.since, value1: context.query.until }) : msg('logQueryDetails.fileTailSampleTheRequestedTimeWindowIs')}</p><small>{msg('logQueryDetails.atMost')} {context.query.lines} {msg('logQueryDetails.entries256KibKeywordsFilterOnlyTheTail')}{context.query.contains && msg('logQueryDetails.filterValue', { value0: context.query.contains })}</small></section>
}
