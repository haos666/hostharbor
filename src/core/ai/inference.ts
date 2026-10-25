import { z } from 'zod'
import { AppError } from '../../shared/errors'
export interface AiTool { name: string; description: string; schema: Record<string, unknown> }
export interface ToolCall { id: string; name: string; input: unknown }
export interface AiTurn { calls: ToolCall[]; anthropicContent?: Record<string, unknown>[] }
export type AiMessage = { role: 'user'; text: string } | { role: 'assistant'; calls: ToolCall[]; anthropicContent?: Record<string, unknown>[] } | { role: 'results'; results: { id: string; value: unknown; error?: boolean }[] }
export function inferenceBody(provider: 'openai' | 'anthropic', model: string, system: string, messages: AiMessage[], tools: AiTool[]) {
  if (provider === 'anthropic') return { model, max_tokens: 8192, system,
    ...(/^MiniMax-M3\.1-Flash(?:-|$)/i.test(model) ? { output_config: { effort: 'low' } } : {}),
    messages: messages.map(m => m.role === 'user' ? { role: 'user', content: m.text } : m.role === 'assistant' ? { role: 'assistant', content: m.anthropicContent ?? m.calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) } : { role: 'user', content: m.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.value), ...(r.error ? { is_error: true } : {}) })) }),
    tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema })), tool_choice: { type: 'any', disable_parallel_tool_use: true },
  }
  return { model, max_completion_tokens: 8192,
    messages: [{ role: 'system', content: system }, ...messages.flatMap<Record<string, unknown>>(m => m.role === 'user' ? [{ role: 'user', content: m.text }] : m.role === 'assistant' ? [{ role: 'assistant', content: null, tool_calls: m.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) }] : m.results.map(r => ({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.value) })))],
    tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })), tool_choice: 'required', parallel_tool_calls: false,
  }
}
const callSchema = z.object({ id: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/), name: z.string().min(1).max(64), input: z.unknown() })
// Diagnostics contain structural metadata only. Never include remote strings or payloads.
export class AiProtocolError extends AppError {
  constructor(readonly diagnostic: string) { super('AI_TOOL_FORMAT') }
}
export function parseInference(provider: 'openai' | 'anthropic', body: unknown): AiTurn {
  let stage = 'envelope', stopReason = 'unknown', count = 0, blocks = 0
  const fail = () => new AiProtocolError(`${provider}; stage=${stage}; stop=${stopReason}; calls=${Math.min(count, 1000)}; blocks=${Math.min(blocks, 1000)}`)
  try {
    const raw = body as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') throw fail()
    // Some compatible providers return an error envelope with HTTP 200.
    const base = raw.base_resp as { status_code?: unknown } | undefined
    if (raw.type === 'error' || raw.error || (base && typeof base.status_code === 'number' && base.status_code !== 0)) {
      stage = 'provider_error'
      throw fail()
    }
    const earlyStop = provider === 'anthropic' ? raw.stop_reason : (raw.choices as { finish_reason?: unknown }[] | undefined)?.[0]?.finish_reason
    if (earlyStop === 'max_tokens' || earlyStop === 'length') throw new AppError('AI_OUTPUT_TRUNCATED')
    let calls: unknown[], anthropicContent: Record<string, unknown>[] | undefined
    if (provider === 'anthropic') {
      const b = z.object({ stop_reason: z.string(), content: z.array(z.record(z.string(), z.unknown())).max(100) }).parse(body)
      blocks = b.content.length
      stopReason = ['max_tokens','tool_use','end_turn','refusal','stop_sequence'].includes(b.stop_reason) ? b.stop_reason : 'unknown'
      if (b.stop_reason === 'max_tokens') throw new AppError('AI_OUTPUT_TRUNCATED')
      calls = b.content.filter(c => c.type === 'tool_use').map(c => ({ id: c.id, name: c.name, input: c.input }))
      count = calls.length
      if (!count) throw new AppError('AI_NO_TOOL_CALL')
      stage = 'stop_reason'
      if (b.stop_reason !== 'tool_use') throw fail()
      anthropicContent = b.content
    } else {
      const b = z.object({ choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ tool_calls: z.array(z.object({ id: z.unknown(), type: z.literal('function'), function: z.object({ name: z.unknown(), arguments: z.string().max(131072) }) })).max(100).default([]) }) })).length(1) }).parse(body)
      stopReason = ['length','tool_calls','stop','content_filter'].includes(b.choices[0].finish_reason) ? b.choices[0].finish_reason : 'unknown'
      if (b.choices[0].finish_reason === 'length') throw new AppError('AI_OUTPUT_TRUNCATED')
      count = b.choices[0].message.tool_calls.length
      if (!count) throw new AppError('AI_NO_TOOL_CALL')
      stage = 'stop_reason'
      if (b.choices[0].finish_reason !== 'tool_calls') throw fail()
      stage = 'arguments_json'
      calls = b.choices[0].message.tool_calls.map(c => ({ id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments) }))
    }
    stage = 'call_limit'
    // Parallel hints are not a protocol guarantee. Execute a valid bounded batch
    // sequentially; OperationService and the total query budget still gate every call.
    if (!calls.length || calls.length > 16) throw fail()
    stage = 'tool_identity'
    const parsed = z.array(callSchema).parse(calls)
    stage = 'duplicate_id'
    if (new Set(parsed.map(c => c.id)).size !== parsed.length) throw fail()
    return { calls: parsed, ...(anthropicContent ? { anthropicContent } : {}) }
  } catch (e) { throw e instanceof AppError ? e : fail() }
}
