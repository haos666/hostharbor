import type { PolicyDecision, QueryAnalysis } from '../../shared/contracts'
import { parseQueryShell, QuerySyntaxError } from './query-shell'
import { resolveQueryPath, type QueryScope } from './query-args'
import { queryRecipe, QueryCommandError } from './query-commands'

// Authorization is a positive, bounded query language. No arbitrary shell input
// is executed because of an absent risk keyword or an AI classification.
export function analyzeQuery(command: string, scope: QueryScope = {}): { plan?: NonNullable<PolicyDecision['queryPlan']>; analysis: QueryAnalysis } {
  const analysis: QueryAnalysis = { version: 2, checks: [] }
  let index = 0, queries = 0, labels = 0
  try {
    const ast = parseQueryShell(command), rendered: string[] = []
    for (const pipeline of ast) {
      const stages: string[] = []
      for (const [position, stage] of pipeline.commands.entries()) {
        index++
        try {
          const recipe = queryRecipe(stage.words, position > 0, scope)
          if (recipe.label) labels++; else queries++
          if (queries > 32) throw new QueryCommandError('最多支持 32 项查询或文本处理')
          analysis.checks.push({ index, status: 'supported', kind: recipe.kind, reason: recipe.notice ?? '参数与查询语义已校验' })
          stages.push(recipe.command + (stage.redirects.length ? ' ' + stage.redirects.join(' ') : ''))
        } catch (error) {
          if (!(error instanceof QueryCommandError)) throw error
          analysis.checks.push({ index, status: 'approval', reason: error.message })
          // Keep checking subsequent stages to make all unsupported parts visible.
        }
      }
      rendered.push(stages.join(' | '))
      if (pipeline.next) rendered.push(pipeline.next)
    }
    if (analysis.issue || analysis.checks.some(c => c.status === 'approval')) return { analysis }
    return { plan: { version: 2, command: rendered.join(' '), queries, labels, ...(scope.revision && ast.some(p => p.commands.some(c => c.words.some(w => scope.logFiles?.includes(resolveQueryPath(w, scope) ?? '')))) ? { scopeRevision: scope.revision } : {}) }, analysis }
  } catch (error) {
    if (!(error instanceof QuerySyntaxError)) throw error
    analysis.issue = error.message
    return { analysis }
  }
}
export function queryPlan(command: string, scope: QueryScope = {}): PolicyDecision['queryPlan'] { return analyzeQuery(command, scope).plan }
export function queryApprovalReason(analysis: QueryAnalysis): string {
  if (analysis.issue) return `需要人工审批：${analysis.issue}`
  const failed = analysis.checks.filter(c => c.status === 'approval')
  return `需要人工审批：${failed.slice(0, 3).map(c => `第 ${c.index} 段：${c.reason}`).join('；')}${failed.length > 3 ? `；另有 ${failed.length - 3} 段需确认` : ''}`
}
