// Bounded literal POSIX-shell subset. This is deliberately not a Bash evaluator.
// Parse before authorization; only a validated AST is rendered, never input text.
export interface QueryCommand { words: string[]; redirects: string[] }
export interface QueryPipeline { commands: QueryCommand[]; next?: ';' | '&&' | '||' }
export class QuerySyntaxError extends Error {}
const fail = (message: string): never => { throw new QuerySyntaxError(message) }
type Token = { type: 'word'; value: string } | { type: 'op'; value: ';' | '&&' | '|' | '\n' | 'redirect' | '||'; redirect?: string }
export function parseQueryShell(source: string, options: { patternWords?: boolean } = {}): QueryPipeline[] {
  if (!source.length || source.length > 16384) fail('命令为空或超过 16384 字符')
  const tokens: Token[] = []; let i = 0
  const push = (token: Token) => { if (tokens.length >= 1024) fail('命令片段或参数过多'); tokens.push(token) }
  while (i < source.length) {
    const c = source[i]
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '\n' || c === ';') { push({ type: 'op', value: c }); i++; continue }
    if (source.startsWith('&&', i)) { push({ type: 'op', value: '&&' }); i += 2; continue }
    if (source.startsWith('||', i)) { push({ type: 'op', value: '||' }); i += 2; continue }
    if (c === '|') { push({ type: 'op', value: '|' }); i++; continue }
    const redirection = source.slice(i).match(/^(2>&1|(?:2>|1?>)\s*\/dev\/null)(?=$|[\s;|&])/)
    if (redirection) {
      push({ type: 'op', value: 'redirect', redirect: redirection[1].replace(/\s/g, '') }); i += redirection[0].length; continue
    }
    let value = '', seen = false
    while (i < source.length && !/[\s;|&]/.test(source[i])) {
      const ch = source[i]
      if (ch === "'" || ch === '"') {
        const quote = ch; seen = true; i++; let closed = false
        while (i < source.length) {
          const q = source[i++]
          if (q === quote) { closed = true; break }
          if (q.charCodeAt(0) < 32 || q.charCodeAt(0) === 127) fail('引号内含控制字符')
          if (quote === '"' && (q === '$' || q === '`')) fail('暂不自动批准变量展开或命令替换')
          if (quote === '"' && q === '\\') {
            const next = source[i++]
            if (!next || !['\\', '"', '$', '`'].includes(next)) fail('双引号转义超出支持范围')
            value += next
          } else value += q
        }
        if (!closed) fail('引号未闭合')
      } else if (ch === '\\') {
        const next = source[++i]; i++
        if (!next) fail('转义未完成')
        if (next === '\n') continue
        if (next.charCodeAt(0) < 32 || next.charCodeAt(0) === 127) fail('命令含控制字符')
        value += next; seen = true
      } else {
        if (/[\x00-\x1f\x7f]/.test(ch)) fail('命令含控制字符')
        if (/[<>]/.test(ch)) fail('写入、输入或文件描述符重定向需人工审批（仅支持 /dev/null 与 2>&1）')
        if (/[$`]/.test(ch)) fail('暂不自动批准变量展开或命令替换')
        if (ch === '[' && (!value || /^https?:\/\/$/.test(value))) {
          const ipv6 = source.slice(i).match(/^\[[0-9a-fA-F]*:[0-9a-fA-F:]*\]/)
          if (ipv6) { value += ipv6[0]; seen = true; i += ipv6[0].length; continue }
        }
        if ((options.patternWords ? /[(){}#]/ : /[(){}*?\[\]~#]/).test(ch)) fail('暂不自动批准分组、通配展开或注释；字面文本请加引号')
        value += ch; seen = true; i++
      }
    }
    if (!seen) fail('后台执行或不支持的 Shell 运算符需人工审批')
    push({ type: 'word', value })
  }
  const pipelines: QueryPipeline[] = []; let pipeline: QueryPipeline = { commands: [] }
  let command: QueryCommand = { words: [], redirects: [] }; let needCommand = false; let count = 0
  const append = () => {
    if (!command.words.length) fail('缺少命令或存在空命令段')
    if (++count > 40) fail('最多支持 40 个命令段')
    pipeline.commands.push(command); command = { words: [], redirects: [] }
  }
  for (const token of tokens) {
    if (token.type === 'word') {
      if (command.redirects.length) fail('重定向必须放在命令段末尾')
      command.words.push(token.value); needCommand = false; continue
    }
    if (token.value === 'redirect') {
      if (!command.words.length || command.redirects.length >= 4) fail('错误输出重定向位置不受支持')
      command.redirects.push(token.redirect!); continue
    }
    if (token.value === '\n' && !command.words.length) continue
    append()
    if (token.value === '|') { needCommand = true; continue }
    pipeline.next = token.value === '&&' || token.value === '||' ? token.value : ';'
    pipelines.push(pipeline); pipeline = { commands: [] }; needCommand = token.value === '&&' || token.value === '||'
  }
  if (needCommand) fail('管道或条件连接后缺少命令')
  if (command.words.length) append()
  if (pipeline.commands.length) pipelines.push(pipeline)
  else if (pipelines.length) delete pipelines.at(-1)!.next
  if (!pipelines.length) fail('没有可识别的命令')
  return pipelines
}
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
