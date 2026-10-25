import { msg, getLocale } from '../../../shared/i18n'
import type { ApprovalAiReview } from '../../../shared/contracts'
const labels: Record<string, string> = { get mutation() { return msg('approvalReview.modification') }, get deletion() { return msg('agentWorkspace.delete') }, get service() { return msg('approvalReview.serviceChange') }, get permissions() { return msg('approvalReview.permissionChange') }, get 'sensitive-read'() { return msg('approvalReview.sensitiveRead') }, get network() { return msg('approvalReview.networkTransfer') }, get dynamic() { return msg('approvalReview.dynamicExecution') }, get uncertain() { return msg('approvalReview.uncertain') } }
export function ApprovalReview({ review, stopped = false }: { review?: ApprovalAiReview; stopped?: boolean }) {
  if (!review) return null
  return <div className="approval-ai-result" role="status"><strong>{msg('approvalReview.aiAssistance')} {review.status === 'pending' ? stopped ? msg('approvalReview.analysisStopped') : msg('approvalReview.analyzing') : review.status === 'complete' ? review.recommendation === 'query' ? msg('approvalReview.suggestedQuery') : msg('approvalReview.manualApprovalSuggested') : msg('approvalReview.referForManualApproval')}</strong>
    <p>{review.status === 'pending' && stopped ? msg('approvalReview.analysisIncompleteNoAutomaticRetry') : review.reason}</p>
    {review.risks?.length ? <p>{review.risks.map(r => labels[r] ?? msg('approvalReview.uncertain')).join(' · ')}</p> : null}
    {review.status === 'complete' && <><small>{review.provider} · {review.model} · {review.reviewedAt && new Date(review.reviewedAt).toLocaleString(getLocale())}</small><p>{msg('approvalReview.thisCommandIsOutsideTheBuiltInVerifiable')}</p></>}
  </div>
}
