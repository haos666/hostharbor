import { msg } from '../../../shared/i18n'
import type { QueryAnalysis } from '../../../shared/contracts'
export function QueryChecks({ analysis }: { analysis?: QueryAnalysis }) {
  if (!analysis) return null
  const manual = analysis.checks.filter(item => item.status === 'approval').length
  return <details className="query-checks"><summary>{msg('queryChecks.segmentChecks')} {analysis.checks.length} {msg('queryChecks.segments')}{manual ? msg('queryChecks.valueSegmentsNeedConfirmation', { value0: manual }) : ''}</summary>
    {analysis.issue && <p>{analysis.issue}</p>}
    <ol>{analysis.checks.map(item => <li key={item.index}><strong>{msg('queryChecks.segmentHeading', { index: item.index, status: item.status === 'supported' ? item.kind : msg('queryChecks.approvalRequired') })}</strong><span>{item.reason}</span></li>)}</ol>
  </details>
}
