import { msg, getLocale, errorText } from '../../../shared/i18n'
import { TransferDetails } from './TransferDetails'
import { QueryChecks } from './QueryChecks'
import { LogQueryDetails } from './LogQueryDetails'
import { ApprovalReview } from './ApprovalReview'
import { useEffect, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import type { AppStatus, Operation, OperationState, OutputChunk } from '../../../shared/contracts'
import type { Result } from '../../../shared/errors'
import { localizedErrors as messages } from '../../../shared/i18n'
import { finishedOperation, replayDuration, replayText } from '../replay'
import { Dialog } from './Dialog'
import { OperationList } from './OperationList'
import { UnlockGate } from './SecuritySettings'
const api = window.hostharbor
function unwrap<T>(r: Result<T>): T { if (!r.ok) throw new Error(errorText(r.error)); return r.value }
export const operationLabels: Record<OperationState, string> = { get awaiting_approval() { return msg('historyPage.awaitingApproval') },get queued() { return msg('historyPage.queued') },get connecting() { return msg('historyPage.connecting') },get dispatching() { return msg('historyPage.dispatching') },get running() { return msg('historyPage.running') },get succeeded() { return msg('historyPage.completed') },get failed() { return msg('historyPage.executionFailed') },get denied() { return msg('historyPage.denied') },get interrupted() { return msg('historyPage.notDispatchedInterrupted') },get unknown() { return msg('historyPage.outcomeUnknown') },get expired() { return msg('historyPage.approvalExpired') } }
const time = (n: number) => new Date(n).toLocaleString(getLocale())
export function HistoryPage({ status, onRefresh, onSetup }: { status: AppStatus | null; onRefresh: () => Promise<void>; onSetup: () => void }) {
  const [selected, setSelected] = useState<Operation | null>(null), [reload, setReload] = useState(0)
  const unlocked = status?.vault === 'unlocked'
  useEffect(() => { setSelected(null) }, [status?.lockRevision, unlocked])
  return <section className={unlocked ? 'history-workspace' : undefined}>
    <header className="credentials-header"><div className="credentials-title"><span className="page-label">{msg('historyPage.localActivityRecords')}</span><h1>{msg('historyPage.operationLogs')}</h1></div></header>
    {!unlocked ? <UnlockGate status={status} onRefresh={onRefresh} onSetup={onSetup} /> : <>
      <OperationList key={status?.lockRevision} history revision={reload} onSelect={setSelected} />
      {selected && <HistoryDetail key={selected.id} operation={selected} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); setReload(n => n + 1) }} />}
    </>}
  </section>
}
function HistoryDetail({ operation: initial, onClose, onChanged }: { operation: Operation; onClose: () => void; onChanged: () => void }) {
  const [operation, setOperation] = useState(initial), [chunks, setChunks] = useState<OutputChunk[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [stream, setStream] = useState<'all'|'stdout'|'stderr'>('all')
  const [confirm, setConfirm] = useState<'output'|'record'|null>(null), [busy,setBusy] = useState(false), alive = useRef(true)
  const duration = replayDuration(chunks), terminal = finishedOperation(operation.state)
  useEffect(() => {
    alive.current = true; let cancelled = false
    void (async () => {
      try {
        const op = unwrap(await api.getOperation(initial.id)); if (cancelled) return; setOperation(op)
        if (!finishedOperation(op.state)) return
        let cursor = 0, loaded: OutputChunk[] = [], size = 0
        for (let i=0; i<4096; i++) {
          const page = unwrap(await api.readOperationOutput({ id: op.id, cursor })); if (cancelled) return
          if (page.replayClearedAt) { setOperation({ ...op, replayClearedAt: page.replayClearedAt }); setChunks([]); return }
          if (page.chunks.length && page.nextCursor <= cursor) throw new Error(msg('historyPage.invalidReplayCursor'))
          loaded.push(...page.chunks); size += page.chunks.reduce((n,c) => n+c.text.length,0); if (size > 16777216) throw new Error(msg('historyPage.replayExceedsReadLimit'))
          cursor = page.nextCursor
          if (page.chunks.length < 8) { setChunks(loaded); setPosition(replayDuration(loaded)); return }
        }
        throw new Error(msg('historyPage.replayExceedsChunkLimit'))
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : msg('historyPage.cannotReadReplay')) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true; alive.current = false }
  }, [initial.id])
  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const timer = window.setInterval(() => { const now=performance.now(), delta=(now-previous)*speed; previous=now; setPosition((old) => { const next=Math.min(duration,old+delta); if(next>=duration) setPlaying(false); return next }) },100)
    return () => window.clearInterval(timer)
  }, [playing,speed,duration])
  async function remove() {
    if (!confirm) return; setBusy(true);setError('');setPlaying(false)
    try { unwrap(confirm === 'output' ? await api.clearOperationOutput(operation.id) : await api.deleteOperation(operation.id)); if(alive.current) onChanged() }
    catch(e) { if(alive.current) setError(e instanceof Error ? e.message : msg('historyPage.cleanupFailed')) }
    finally { if(alive.current) setBusy(false) }
  }
  const frame = replayText(chunks,position,stream), seconds=(ms:number)=>(ms/1000).toFixed(1)+'s'
  return <><Dialog className="agent-dialog operation-dialog" labelledBy="history-detail-title" onDismiss={onClose}><header className="agent-dialog-header"><h2 id="history-detail-title">{operationLabels[operation.state]}</h2><button className="icon-button" aria-label={msg('historyPage.closeLogDetails')} onClick={onClose}><X size={18}/></button></header>
    <dl className="operation-details"><dt>{msg('historyPage.serverAccess')}</dt><dd>{operation.serverName} / {operation.profileName}</dd><dt>{msg('historyPage.targetSnapshot')}</dt><dd>{operation.routeServers.map((s)=>`${s.name} · ${s.username}@${s.host}:${s.port} (v${s.revision})`).join(' ← ')}</dd><dt>{msg('historyPage.submitted')}</dt><dd>{time(operation.createdAt)}</dd><dt>{msg('common.approval')}</dt><dd>{operation.humanDecision ? `${operation.humanDecision==='approved'?msg('historyPage.manuallyApproved'):msg('historyPage.manuallyDenied')} · ${time(operation.decidedAt!)}` : operation.decision?.reason ?? msg('historyPage.legacyRecordApprovalTimeNotRecorded')}</dd><dt>{msg('historyPage.matchBasis')}</dt><dd>{operation.decision ? msg('historyPage.policyVValueValue', { value0: operation.decision.revision, value1: operation.decision.matchedRules.map((r)=>`${r.risk?msg('agentWorkspace.highRisk'):''}${r.name}`).join(msg('common.listSeparator')) || operation.decision.reason }):msg('agentWorkspace.legacyAccessPolicy')}</dd><dt>{msg('historyPage.dispatchedLastUpdated')}</dt><dd>{operation.intentAt?time(operation.intentAt):msg('historyPage.notDispatched')} / {time(operation.updatedAt)}</dd><dt>{msg('agentWorkspace.executionIdentity')}</dt><dd>{operation.input.elevation === 'sudo' ? msg('agentWorkspace.sudoRootApprovalPolicyAppliesAuthenticationHandledIn') : msg('agentWorkspace.sshLoginAccount')}</dd><dt>{msg('historyPage.directory')}</dt><dd>{operation.input.cwd} {msg('historyPage.remoteConfirmed')}{operation.confirmedCwd??msg('historyPage.notReceived')}</dd><dt>{msg('historyPage.exitResult')}</dt><dd>{operation.exitCode===undefined?msg('historyPage.noExitCodeReceived'):msg('historyPage.exitCodeValue', { value0: operation.exitCode })}{operation.signal?` · ${operation.signal}`:''}</dd><dt>{msg('historyPage.originalOutputSize')}</dt><dd>{(operation.outputBytes/1024).toFixed(1)} KiB</dd></dl>
    <TransferDetails operation={operation} /><LogQueryDetails operation={operation} />
    <ApprovalReview review={operation.decision?.aiReview} stopped />
    <pre className="operation-command">{operation.input.command}</pre>
    <QueryChecks analysis={operation.decision?.queryAnalysis} />
    {operation.decision?.queryPlan && <details><summary>{msg('agentWorkspace.verifiedQueryToExecute')}</summary><pre className="operation-command">{operation.decision.queryPlan.command}</pre></details>}
    {operation.state==='unknown'&&<p className="operation-warning">{operation.transfer ? msg('agentWorkspace.finalFilePublicationIsUnconfirmedCheckTheDestination') : msg('historyPage.remoteOutcomeAndProcessStateAreUnconfirmedDo')}</p>}
    {operation.errorCode&&!operation.fileResult?.failure&&<p className="operation-warning">{messages[operation.errorCode as keyof typeof messages]??operation.errorCode}</p>}
    {error&&<p className="drawer-error" role="alert">{error}</p>}
    <h3>{operation.transfer ? msg('historyPage.transferRecords') : msg('historyPage.outputReplay')}</h3>{operation.transfer ? <p>{msg('historyPage.fileContentsAreNotRecordedSeeTransferResults')}</p> : !terminal?<p>{msg('historyPage.taskIsStillActiveFollowLiveOutputIn')}</p>:loading?<p>{msg('historyPage.readingReplay')}</p>:operation.replayClearedAt?<p>{msg('historyPage.replayCleared')}{({expired:msg('historyPage.retentionExpired'),quota:msg('historyPage.storageQuota'),manual:msg('historyPage.manualCleanup')} as Record<string,string>)[operation.replayClearReason??'']??msg('historyPage.cleared')} · {time(operation.replayClearedAt)}{msg('historyPage.commandAndResultSummariesRemain')}</p>:!chunks.length?<p>{msg('historyPage.noOutputWasRecordedForThisOperation')}</p>:<>
      <div className="replay-controls"><button className="credential-secondary" aria-label={playing?msg('historyPage.pauseReplay'):msg('historyPage.playReplay')} onClick={()=>{if(position>=duration)setPosition(0);setPlaying(!playing)}}>{playing?<Pause size={15}/>:<Play size={15}/>} {playing?msg('historyPage.pause'):msg('historyPage.play')}</button><select aria-label={msg('historyPage.replaySpeed')} value={speed} onChange={(e)=>setSpeed(Number(e.target.value))}>{[.5,1,2,4,8].map((n)=><option key={n} value={n}>{n}×</option>)}</select><select aria-label={msg('historyPage.outputStream')} value={stream} onChange={(e)=>setStream(e.target.value as typeof stream)}><option value="all">{msg('historyPage.allOutput')}</option><option value="stdout">stdout</option><option value="stderr">stderr</option></select><span>{seconds(position)} / {seconds(duration)}</span></div>
      <input className="replay-timeline" type="range" aria-label={msg('historyPage.replayProgress')} min={0} max={Math.max(1,duration)} value={position} onChange={(e)=>{setPlaying(false);setPosition(Number(e.target.value))}} />
      <p className="agent-hint">{msg('historyPage.timeStartsAtTheFirstOutputChunkReplay')}</p>{frame.truncated&&<p>{msg('historyPage.onlyTheLast1MiCharactersAtThe')}</p>}<pre tabIndex={0} aria-label={msg('historyPage.replayOutput')} className="operation-output">{frame.text||msg('historyPage.noOutputAtThisPosition')}</pre>
    </>}
    <div className="agent-dialog-actions"><button className="credential-secondary" onClick={onClose}>{msg('approvalSettings.close')}</button>{terminal&&<>{!operation.replayClearedAt&&!!operation.outputBytes&&<button className="credential-secondary" onClick={()=>{setPlaying(false);setConfirm('output')}}>{msg('historyPage.clearReplay')}</button>}<button className="text-button" onClick={()=>{setPlaying(false);setConfirm('record')}}>{msg('historyPage.deleteEntireRecord')}</button></>}</div>
  </Dialog>{confirm&&<Dialog className="credential-confirm" labelledBy="history-clean-title" onDismiss={()=>{if(!busy)setConfirm(null)}}><h2 id="history-clean-title">{confirm==='output'?msg('historyPage.clearThisOutputReplay'):msg('historyPage.deleteThisOperationRecord')}</h2><p>{confirm==='output'?msg('historyPage.outputCannotBeRecoveredCommandApprovalBasisAnd'):msg('historyPage.commandOutputAndResultCannotBeRecoveredOnly')}</p>{error&&<p className="drawer-error" role="alert">{error}</p>}<div className="confirm-actions"><button className="credential-secondary" disabled={busy} onClick={()=>setConfirm(null)}>{msg('agentWorkspace.cancel')}</button><button className="destructive-button" disabled={busy} onClick={()=>void remove()}>{busy?msg('aiSettings.processing'):msg('historyPage.confirmCleanup')}</button></div></Dialog>}</>
}
