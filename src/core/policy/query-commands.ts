import { shellQuote } from './query-shell'
import { QueryCommandError, fail, number, unit, text, oneOf, flags, directory, metadataPath, certificate, queryFile, options, type ValueCheck, type Spec, type QueryRecipe, type QueryScope } from './query-args'
import { extendedQueryRecipe } from './query-diagnostics'
export { QueryCommandError } from './query-args'
const format = (fields: string[]): ValueCheck => value => {
  if (!text(value.replace(/\t/g, ' '))) return false
  const remainder = value.replace(/{{\s*(?:json\s+)?\.([A-Za-z.]+)\s*}}/g, (match, field) => fields.includes(field) ? '' : match)
  return !/[{}]/.test(remainder)
}
const dockerPsFormat = format(['ID', 'Names', 'Image', 'Status', 'Ports', 'State', 'RunningFor', 'Networks', 'Mounts', 'Size', 'CreatedAt', 'Repository', 'Tag', 'Digest', 'Container', 'Name', 'CPUPerc', 'MemUsage', 'MemPerc', 'NetIO', 'BlockIO', 'PIDs'])
const dockerInspectFormat = format(['Name', 'Id', 'Config.Image', 'State.Status', 'State.Pid', 'State.Running', 'NetworkSettings.Ports'])
const binaries: Record<string, string> = {
  pwd: '/bin/pwd', uname: '/usr/bin/uname', uptime: '/usr/bin/uptime', free: '/usr/bin/free', df: '/usr/bin/df', nproc: '/usr/bin/nproc', hostname: '/bin/hostname', date: '/bin/date',
  ss: '/usr/bin/ss', ps: '/bin/ps', docker: '/usr/bin/docker', systemctl: '/usr/bin/systemctl', journalctl: '/usr/bin/journalctl',
  cat: '/bin/cat', head: '/usr/bin/head', tail: '/usr/bin/tail', grep: '/usr/bin/grep', sed: '/usr/bin/sed', awk: '/usr/bin/awk', cut: '/usr/bin/cut', sort: '/usr/bin/sort', uniq: '/usr/bin/uniq', wc: '/usr/bin/wc',
  ls: '/bin/ls', find: '/usr/bin/find', openssl: '/usr/bin/openssl',
}
export function queryRecipe(words: string[], pipedInput: boolean, scope: QueryScope = {}, depth = 0): QueryRecipe {
  if (['timeout', '/usr/bin/timeout', '/bin/timeout'].includes(words[0])) {
    if (depth >= 2 || !/^(?:[1-9]|[12][0-9]|30)s?$/.test(words[1] ?? '') || words.length < 3) fail('timeout 只支持 1..30 秒和已校验的查询')
    const inner = queryRecipe(words.slice(2), pipedInput, scope, depth + 1)
    return { ...inner, command: `/usr/bin/timeout ${shellQuote(words[1])} ${inner.command}` }
  }
  const extension = extendedQueryRecipe(words, pipedInput, scope)
  if (extension) return extension
  const requested = words[0], args = words.slice(1)
  const name = requested.split('/').at(-1)!
  if (requested.includes('/') && ![binaries[name], `/bin/${name}`, `/sbin/${name}`, `/usr/bin/${name}`, `/usr/sbin/${name}`].includes(requested)) fail('仅支持已登记的系统工具路径')
  const render = (values: string[], kind: string): QueryRecipe => ({ command: [binaries[name], ...values.map(value => /^[-A-Za-z0-9_./:=,@]+$/.test(value) ? value : shellQuote(value))].join(' '), kind })
  if (requested === 'echo') {
    if (args.length > 16 || /^-[eE]+$/.test(args[0]) || args.some(a => a.length > 512 || a.includes('\\'))) fail('输出标签只支持普通字面文本')
    return { command: `/usr/bin/printf ${shellQuote(args[0] === '-n' ? '%s' : '%s\\n')} ${shellQuote((args[0] === '-n' ? args.slice(1) : args).join(' '))}`, kind: '输出标签', label: true }
  }
  if (requested === 'printf') {
    if (args.length < 2 || !['%s\\n', '%s\n', '%s'].includes(args[0]) || args.slice(1).some(a => a.length > 512)) fail('printf 只支持固定 %s 或 %s\\n 字面标签')
    return { command: `/usr/bin/printf ${shellQuote(args[0])} ${args.slice(1).map(shellQuote).join(' ')}`, kind: '输出标签', label: true }
  }
  if (!Object.hasOwn(binaries, name)) fail('命令尚未登记为可自动通过的查询；脚本、解释器和权限提升需人工审批')
  const simple: Record<string, Spec> = {
    pwd: flags('-P', '-L'), uname: flags('-a', '-r', '-s', '-n', '-m', '-v', '-p', '-i', '-o', '--all', '--kernel-release', '--machine'), uptime: flags('-p', '-s'),
    free: flags('-h', '-m', '-g', '-b', '-k', '-t', '--human', '--mega'), df: flags('-h', '-T', '-i', '-P', '-k', '--human-readable', '--print-type'),
    nproc: flags('--all'), hostname: flags('-f', '-s', '-I', '-i', '-d'), date: { '-u': true, '--utc': true, '-I': oneOf('s', 'seconds', 'date'), '-Is': true, '--iso-8601': oneOf('seconds', 'date') },
    ss: flags('-l', '-n', '-t', '-u', '-p', '-a', '-s', '-4', '-6', '-H', '-e', '-o', '--listening', '--numeric', '--tcp', '--udp', '--processes', '--all', '--summary'),
    ps: { ...flags('-e', '-f', '-a', '-u', '-x', '-w', '--forest'), '-o': s => /^[A-Za-z0-9_,=:% -]{1,128}$/.test(s) && s.split(',').every(v => /^(?:pid|ppid|user|uid|comm|args|cmd|command|stat|etime|etimes|pcpu|pmem|%cpu|%mem|rss|vsz)(?:=[A-Za-z0-9_ %]*)?$/.test(v)), '-p': s => /^\d+(?:,\d+)*$/.test(s) && s.length <= 100, '-C': unit, '--sort': s => s.split(',').every(v => /^[+-]?(?:pid|ppid|pcpu|pmem|%cpu|%mem|rss|vsz|etime|comm)$/.test(v)) },
  }
  if (Object.hasOwn(simple, name)) {
    const position: ValueCheck = name === 'ps' ? oneOf('aux', 'ax', 'ef') : name === 'date' ? s => /^\+[A-Za-z0-9%: ./_-]{1,100}$/.test(s) : name === 'df' ? p => metadataPath(p, scope) : () => false
    return render(options(args, simple[name], position, 1).args, name === 'ss' ? '端口查询' : name === 'ps' ? '进程查询' : '系统查询')
  }
  if (name === 'docker') {
    const action = args.shift()
    if (action === 'ps' || action === 'images') {
      const spec = { ...flags('-a', '--all', '-q', '--quiet', '--no-trunc'), '--format': dockerPsFormat }
      return render([action, ...options(args, spec).args], '容器查询')
    }
    if (action === 'inspect') {
      const result = options(args, { '--format': dockerInspectFormat, '-f': dockerInspectFormat, '--type': oneOf('container') }, unit, 8)
      if (!result.operands.length || (!result.used.has('--format') && !result.used.has('-f'))) fail('容器 inspect 仅支持明确字段；完整配置可能包含凭证')
      return render(['inspect', ...result.args], '容器查询')
    }
    if (action === 'stats') {
      const result = options(args, { ...flags('--no-stream', '--all', '-a', '--no-trunc'), '--format': dockerPsFormat }, unit, 8)
      if (!result.used.has('--no-stream')) fail('容器资源查询必须使用 --no-stream，不允许持续采样')
      return render(['stats', ...result.args], '容器资源快照')
    }
    if (action === 'top') {
      const result = options(args, {}, unit, 1)
      if (result.operands.length !== 1) fail('容器进程查询必须指定单个容器')
      return render(['top', ...result.args], '容器进程查询')
    }
    if (action === 'logs') {
      const result = options(args, { '--tail': number, '--timestamps': true, '-t': true, '--since': s => /^(?:[1-9][0-9]{0,3}[smh]|\d{4}-\d{2}-\d{2}T[0-9:+.-]+Z?)$/.test(s) }, unit, 1)
      if (result.operands.length !== 1 || !result.used.has('--tail')) fail('容器日志必须指定单个容器和 --tail 1..2000；不支持跟随输出')
      return render(['logs', ...result.args], '容器日志查询')
    }
    fail('容器子命令未列入查询范围；创建、执行、复制、启停等需人工审批')
  }
  if (name === 'systemctl') {
    const actionIndex = args.findIndex(v => ['list-units', 'list-unit-files', 'list-timers', 'list-sockets', 'status', 'show', 'is-active', 'is-enabled', 'is-failed'].includes(v))
    const action = args[actionIndex]
    if (!['list-units', 'list-unit-files', 'list-timers', 'list-sockets', 'status', 'show', 'is-active', 'is-enabled', 'is-failed'].includes(action)) fail('服务子命令未列入查询范围；启停、重载等需人工审批')
    args.splice(actionIndex, 1)
    const spec: Spec = { ...flags('--no-pager', '--no-legend', '--plain', '--all', '-a', '--full', '-l', '--failed', '--value', '--quiet', '-q'), '--type': oneOf('service', 'socket', 'timer'), '--state': s => s.split(',').every(oneOf('running', 'active', 'inactive', 'failed', 'dead', 'exited', 'listening')), '--property': s => s.split(',').every(oneOf('Id', 'MainPID', 'WorkingDirectory', 'FragmentPath', 'ActiveState', 'SubState', 'LoadState', 'UnitFileState', 'ExecStart', 'ExecMainPID', 'ExecMainStatus', 'Result', 'User', 'Group', 'Description', 'Restart', 'NRestarts', 'ActiveEnterTimestamp')), '-p': s => s.split(',').every(oneOf('Id', 'MainPID', 'WorkingDirectory', 'FragmentPath', 'ActiveState', 'SubState', 'LoadState', 'UnitFileState', 'ExecStart', 'ExecMainPID', 'ExecMainStatus', 'Result', 'User', 'Group', 'Description', 'Restart', 'NRestarts', 'ActiveEnterTimestamp')) }
    const result = options(args, spec, unit, 8)
    if (!action.startsWith('list-') && !result.operands.length) fail('服务详情查询必须指定服务')
    if (action === 'show' && !result.used.has('--property') && !result.used.has('-p')) fail('服务 show 必须指定支持的字段，避免读取完整环境配置')
    return render([action, '--no-pager', ...result.args], '服务查询')
  }
  if (name === 'journalctl') {
    const result = options(args, { ...flags('--no-pager', '--utc', '-r'), '-u': unit, '--unit': unit, '-n': number, '--lines': number, '-p': oneOf('emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug', '0', '1', '2', '3', '4', '5', '6', '7'), '--since': s => /^(?:today|yesterday|[0-9]{4}-[0-9]{2}-[0-9]{2}(?: [0-9:]{5,8})?|[1-9][0-9]{0,3} (?:min|hour) ago)$/.test(s) })
    if (!result.used.has('-u') && !result.used.has('--unit')) fail('journalctl 必须限定服务')
    return render(['--no-pager', ...(result.used.has('-n') || result.used.has('--lines') ? [] : ['-n', '200']), ...result.args], '服务日志查询')
  }
  if (name === 'cat') {
    const result = options(args, flags('-n', '-b', '-s', '-E', '-T'), p => queryFile(p, scope), 8)
    if (!result.operands.length && !pipedInput) fail('文件查询必须指定受支持的文件')
    return { ...render(result.args, '文件查询'), ...(result.operands.some(p => /\/(?:logs?|logfiles)\//.test(p) || scope.logFiles?.includes(p)) ? { notice: '读取已授权日志，输出受录制配额限制；大日志建议 tail/head 或结构化日志采样' } : {}) }
  }
  if (name === 'ls') {
    const result = options(args, { ...flags('-l', '-a', '-h', '-n', '-d', '-t', '-r', '-S', '-1'), '--color': oneOf('never') }, p => metadataPath(p, scope), 8)
    if (!result.operands.length) result.args.push('.')
    return render(result.args, '目录查询')
  }
  if (name === 'find') {
    if (args[0] === '-P') args.shift()
    const root = args.shift() ?? '.'
    if (!root || root.startsWith('-') || !metadataPath(root, scope)) fail('find 只支持明确路径，不跟随符号链接；选项不能充当路径')
    let depth = '2'; const predicates: string[] = []
    while (args.length) {
      const option = args.shift()!, value = args.shift()
      if (option === '-maxdepth' && value && /^[1-3]$/.test(value)) depth = value
      else if (option === '-mindepth' && value && /^[0-3]$/.test(value)) predicates.push(option, value)
      else if (option === '-type' && value && /^[fd]$/.test(value)) predicates.push(option, value)
      else if (option === '-name' && value && /^[A-Za-z0-9_.*?-]{1,100}$/.test(value)) predicates.push(option, value)
      else if (option === '-print' && value === undefined) break
      else fail('find 仅支持有界目录元数据查询；执行、删除、格式脚本或链接跟随需审批')
    }
    return render(['-P', root!, '-maxdepth', depth, ...predicates, '-print'], '目录查询')
  }
  if (name === 'openssl') {
    if (args.shift() !== 'x509') fail('openssl 仅支持本地证书 x509 信息查询；网络探测及其他子命令需审批')
    const result = options(args, { ...flags('-noout', '-dates', '-enddate', '-startdate', '-issuer', '-subject', '-serial', '-fingerprint', '-sha256'), '-in': p => certificate(p, scope), '-checkend': s => /^\d{1,8}$/.test(s) })
    if ((!result.used.has('-in') && !pipedInput) || !['-dates', '-enddate', '-startdate', '-issuer', '-subject', '-serial', '-fingerprint', '-checkend'].some(v => result.used.has(v))) fail('证书查询需指定支持目录内的证书与输出字段；不读取私钥')
    return render(['x509', '-noout', ...result.args], '证书信息查询')
  }
  if (name === 'head' || name === 'tail') {
    if (/^-\d+$/.test(args[0] ?? '')) args.splice(0, 1, '-n', args[0].slice(1))
    const result = options(args, { '-n': number, '--lines': number, '-c': number, '--bytes': number, '-q': true }, p => queryFile(p, scope), 8)
    if (!result.operands.length && !pipedInput) fail('文本截取需要上游管道或支持的日志/系统文件')
    return render(result.args, '文本截取')
  }
  if (name === 'grep') {
    // -e inserts a known pattern position; option-looking patterns stay data.
    const spec: Spec = { ...flags('-i', '-n', '-v', '-E', '-F', '-c', '-h', '-H', '-o', '-s', '-w', '-x', '-q', '-a', '--quiet', '--ignore-case', '--line-number', '--fixed-strings', '--extended-regexp'), '-e': text, '--regexp': text, '-m': number, '--max-count': number, '-A': number, '-B': number, '-C': number }
    const result = options(args, spec, s => text(s), 9)
    const hasPatternOption = result.used.has('-e') || result.used.has('--regexp')
    const files = result.operands.slice(hasPatternOption ? 0 : 1)
    if ((!hasPatternOption && !result.operands.length) || files.some(p => !queryFile(p, scope)) || (!files.length && !pipedInput)) fail('grep 需要字面搜索条件和上游管道或支持的文件；不支持递归及外部模式文件')
    return render(result.args, '文本搜索')
  }
  if (name === 'awk') {
    // Only a field projection, never a general AWK program.
    const program = args.shift()
    if (!program || !/^\{\s*print\s+\$[0-9]{1,2}(?:\s*,\s*\$[0-9]{1,2})*\s*\}$/.test(program)) fail('awk 仅支持固定字段输出；通用脚本需人工审批')
    if (args.some(a => !queryFile(a, scope)) || args.length > 8 || (!args.length && !pipedInput)) fail('awk 需要上游管道或支持的文件')
    return render([program!, ...args], '字段提取')
  }
  if (name === 'sed') {
    if (args.shift() !== '-n') fail('sed 仅支持 -n 数字行范围 p；修改或通用脚本需人工审批')
    const program = args.shift()
    if (!program || !/^[1-9][0-9]{0,5}(?:,[1-9][0-9]{0,5})?p$/.test(program)) fail('sed 仅支持数字行范围 p，不支持执行/写入表达式')
    if (args.some(a => !queryFile(a, scope)) || args.length > 8 || (!args.length && !pipedInput)) fail('sed 需要上游管道或支持的文件')
    return render(['-n', program!, ...args], '文本截取')
  }
  const filters: Record<string, Spec> = {
    cut: { '-d': s => s.length === 1, '--delimiter': s => s.length === 1, '-f': s => /^[1-9][0-9]?(?:[-,][1-9][0-9]?)*$/.test(s), '-c': s => /^[1-9][0-9]?(?:[-,][1-9][0-9]?)*$/.test(s) },
    sort: { ...flags('-n', '-r', '-u', '-h', '-f', '-V', '-b'), '-k': s => /^[1-9][0-9]?(?:\.[1-9][0-9]?)?[nr]?(?:,[1-9][0-9]?(?:\.[1-9][0-9]?)?[nr]?)?$/.test(s), '-t': s => s.length === 1 }, uniq: flags('-c', '-d', '-u'), wc: flags('-l', '-w', '-c', '-m', '-L'),
  }
  if (Object.hasOwn(filters, name)) {
    const result = options(args, filters[name], p => queryFile(p, scope), name === 'uniq' ? 1 : 8)
    if (!result.operands.length && !pipedInput) fail('文本处理需要上游管道或支持的文件')
    if (name === 'cut' && !result.used.has('-f') && !result.used.has('-c')) fail('cut 必须指定字段或字符范围')
    return render(result.args, '文本处理')
  }
  return fail('尚不支持的查询用法')
}
