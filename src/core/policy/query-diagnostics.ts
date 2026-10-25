import { shellQuote } from './query-shell'
import { directory, metadataPath, resolveQueryPath, options, flags, oneOf, unit, number, fail, type QueryRecipe, type QueryScope, type Spec } from './query-args'
const render = (binary: string, args: string[], kind: string, notice?: string): QueryRecipe => ({ command: [binary, ...args.map(shellQuote)].join(' '), kind, ...(notice ? { notice } : {}) })
const versions: Record<string, { path: string; args: string[] }> = {
  nginx: { path: '/usr/sbin/nginx', args: ['-v', '-V'] }, apache2: { path: '/usr/sbin/apache2', args: ['-v', '-V'] }, httpd: { path: '/usr/sbin/httpd', args: ['-v', '-V'] },
  node: { path: '/usr/bin/node', args: ['-v', '--version'] }, python: { path: '/usr/bin/python', args: ['-V', '--version'] }, python3: { path: '/usr/bin/python3', args: ['-V', '--version'] },
  java: { path: '/usr/bin/java', args: ['-version', '--version'] }, php: { path: '/usr/bin/php', args: ['-v', '--version'] }, ruby: { path: '/usr/bin/ruby', args: ['-v', '--version'] },
  mysql: { path: '/usr/bin/mysql', args: ['-V', '--version'] }, psql: { path: '/usr/bin/psql', args: ['-V', '--version'] }, postgres: { path: '/usr/bin/postgres', args: ['-V', '--version'] },
  'redis-server': { path: '/usr/bin/redis-server', args: ['-v', '--version'] }, 'redis-cli': { path: '/usr/bin/redis-cli', args: ['-v', '--version'] },
  git: { path: '/usr/bin/git', args: ['--version'] }, go: { path: '/usr/bin/go', args: ['version'] }, docker: { path: '/usr/bin/docker', args: ['-v', '--version'] }, curl: { path: '/usr/bin/curl', args: ['-V', '--version'] }, openssl: { path: '/usr/bin/openssl', args: ['version'] },
}
const executablePath = (raw: string, name: string, scope: QueryScope) => { const path = resolveQueryPath(raw, scope) ?? ''; return directory(path) && (/^\/(?:usr\/(?:local\/)?(?:s?bin)|s?bin)\//.test(path) || /^\/(?:opt|srv|data|usr\/local)\//.test(path)) && path.split('/').at(-1) === name }
const host = (raw: string, scope: QueryScope) => {
  const canonical = (s: string) => { try { return new URL(`http://${s.includes(':') && !s.startsWith('[') ? `[${s}]` : s}`).hostname.toLowerCase() } catch { return '' } }
  return ['localhost', '127.0.0.1', '[::1]', ...(scope.hosts ?? []).map(canonical)].includes(canonical(raw)) && !!canonical(raw)
}
const smallTime = (s: string) => /^\d{1,2}(?:\.\d)?$/.test(s) && Number(s) >= 1 && Number(s) <= 30
function httpUrl(raw: string, scope: QueryScope): boolean {
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && host(url.hostname, scope) && raw.length <= 1024
  } catch { return false }
}
function curl(args: string[], scope: QueryScope): QueryRecipe {
  const writeFormat = (s: string) => s.length <= 256 && !s.startsWith('@') && !/[\x00-\x1f\x7f]/.test(s) && !/[{}]/.test(s.replace(/%\{(?:http_code|response_code|time_total|time_connect|time_starttransfer|remote_ip|remote_port|size_download|content_type|ssl_verify_result|url_effective)\}/g, '')) && !s.includes('%output')
  const spec: Spec = { ...flags('-s', '-S', '-I', '-i', '-f', '--silent', '--show-error', '--head', '--include', '--fail'), '-m': smallTime, '--max-time': smallTime, '--connect-timeout': smallTime, '-X': oneOf('GET', 'HEAD'), '--request': oneOf('GET', 'HEAD'), '-o': oneOf('/dev/null'), '--output': oneOf('/dev/null'), '-w': writeFormat, '--write-out': writeFormat, '--url': s => httpUrl(s, scope) }
  const result = options(args, spec, s => httpUrl(s, scope), 1)
  const namedUrls = result.entries.filter(e => e.name === '--url').map(e => e.value!)
  if (result.operands.length + namedUrls.length !== 1) fail('HTTP 查询必须明确指定一个本机或当前服务器地址，不允许凭证、查询串或多目标')
  const url = new URL([...result.operands, ...namedUrls][0])
  const methods = result.entries.filter(e => ['-X', '--request'].includes(e.name)).map(e => e.value!)
  const isHead = result.used.has('-I') || result.used.has('--head') || methods.includes('HEAD')
  if (!isHead && !['/', '/health', '/healthz', '/ready', '/readyz', '/status', '/ping', '/version', '/metrics'].includes(url.pathname)) fail('GET 只支持固定健康/状态路径；其他 URL 需人工审批，可用 HEAD 查看响应头')
  if (methods.length > 1 || (isHead && methods.includes('GET'))) fail('HTTP 请求方法重复或相互冲突')
  const requestArgs = result.entries.filter(e => !['--url', '-X', '--request'].includes(e.name)).flatMap(e => e.value === undefined ? [e.name] : e.name.startsWith('--') ? [e.name + '=' + e.value] : [e.name, e.value])
  const maxTime = Math.min(10, ...result.entries.filter(e => ['-m', '--max-time'].includes(e.name)).map(e => Number(e.value)))
  const connectTime = Math.min(5, ...result.entries.filter(e => e.name === '--connect-timeout').map(e => Number(e.value)))
  // -q is first: ignore .curlrc. Never use proxy/netrc, credentials or redirects.
  return render('/usr/bin/curl', ['-q', ...requestArgs, ...(isHead ? ['--head'] : []), '--noproxy', '*', '--proto', '=http,https', '--max-redirs', '0', '--connect-timeout', String(connectTime), '--max-time', String(maxTime), '--max-filesize', '262144', '--url', url.href], 'HTTP 探测', '仅本机/当前服务器的响应头或固定健康路径；忽略 curl 配置与代理，不跟随跳转，最多10秒/256 KiB')
}
export function extendedQueryRecipe(words: string[], pipedInput: boolean, scope: QueryScope): QueryRecipe | undefined {
  const requested = words[0], args = words.slice(1), name = requested.split('/').at(-1)!
  const version = Object.hasOwn(versions, name) ? versions[name] : undefined
  if (version && args.length === 1 && version.args.includes(args[0])) {
    if (requested.includes('/') && !executablePath(requested, name, scope)) fail('程序版本查询路径须位于系统或部署目录；不允许临时/任意程序')
    return render(requested.includes('/') ? requested : version.path, args, '程序版本', '仅登记程序的版本参数；远端程序和环境仍由服务器管理员信任')
  }
  const known: Record<string, string> = { curl: '/usr/bin/curl', timeout: '/usr/bin/timeout', stat: '/usr/bin/stat', readlink: '/usr/bin/readlink', realpath: '/usr/bin/realpath', du: '/usr/bin/du', lscpu: '/usr/bin/lscpu', lsblk: '/usr/bin/lsblk', ip: '/usr/sbin/ip', top: '/usr/bin/top', vmstat: '/usr/bin/vmstat', id: '/usr/bin/id', whoami: '/usr/bin/whoami', getconf: '/usr/bin/getconf' }
  if (name === 'openssl' && args[0] === 's_client') {
    if (requested.includes('/') && !['/usr/bin/openssl', '/bin/openssl'].includes(requested)) fail('TLS 查询只支持登记的系统工具')
    args.shift()
    const target = (s: string) => { const match = s.match(/^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9_.-]+):([0-9]{1,5})$/); return !!match && Number(match[2]) > 0 && Number(match[2]) <= 65535 && host(match[1], scope) }
    const result = options(args, { '-connect': target, '-servername': s => /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(s), '-showcerts': true, '-brief': true })
    if (!result.used.has('-connect')) fail('TLS 查询必须限定本机或当前服务器的端口')
    return { ...render('/usr/bin/openssl', ['s_client', '-no_ign_eof', ...result.args], 'TLS 证书探测', '固定10秒上限并关闭输入；仅握手和公开证书信息，不发送应用数据'), command: `/usr/bin/timeout 10 ${render('/usr/bin/openssl', ['s_client', '-no_ign_eof', ...result.args], '').command} </dev/null` }
  }
  if (name === 'command' || name === 'which') {
    if (![name, `/usr/bin/${name}`, `/bin/${name}`].includes(requested) || (name === 'command' && args.shift() !== '-v') || !args.length || args.length > 8 || args.some(a => !/^[A-Za-z][A-Za-z0-9_.+-]{0,63}$/.test(a))) fail('命令定位只支持字面工具名称，不执行脚本或 Shell 包装')
    return { command: `command -v ${args.map(shellQuote).join(' ')}`, kind: '程序路径查询' }
  }
  if (!Object.hasOwn(known, name)) return undefined
  if (requested.includes('/') && ![known[name], `/bin/${name}`, `/sbin/${name}`, `/usr/bin/${name}`, `/usr/sbin/${name}`].includes(requested)) fail('仅支持登记的系统工具路径')
  if (name === 'timeout') return undefined // handled recursively by the AST validator
  if (name === 'curl') return curl(args, scope)
  if (['stat', 'readlink', 'realpath', 'du'].includes(name)) {
    const spec: Spec = name === 'stat' ? { ...flags('-L', '-f', '--terse'), '-c': s => s.length <= 200 && !/[{}\x00-\x1f\x7f]/.test(s), '--format': s => s.length <= 200 && !/[{}\x00-\x1f\x7f]/.test(s) }
      : name === 'readlink' || name === 'realpath' ? flags('-f', '-e', '-m', '-q') : { ...flags('-s', '-h', '-x', '-k', '-b', '-c', '--summarize', '--human-readable'), '--max-depth': s => /^[0-3]$/.test(s), '-d': s => /^[0-3]$/.test(s) }
    const result = options(args, spec, p => metadataPath(p, scope), 8)
    if (!result.operands.length) { if (name === 'du') result.args.push('.'); else fail('元数据查询必须指定路径') }
    return render(known[name], result.args, name === 'du' ? '磁盘占用查询' : '文件元数据')
  }
  if (name === 'lscpu') return render(known[name], options(args, flags('-J', '--json', '-e', '--extended')).args, 'CPU 查询')
  if (name === 'lsblk') return render(known[name], options(args, { ...flags('-f', '-a', '-b', '-d', '-n', '-l', '-J', '--json'), '-o': s => s.split(',').every(oneOf('NAME', 'KNAME', 'SIZE', 'TYPE', 'FSTYPE', 'MOUNTPOINT', 'MOUNTPOINTS', 'FSUSE%', 'UUID', 'MODEL', 'SERIAL', 'ROTA', 'RO', 'LABEL')) }).args, '块设备查询')
  if (name === 'ip') {
    const supported = ['addr', 'address', 'a', 'route', 'r', 'link', 'l', 'neigh', 'neighbor']
    const at = args.findIndex(a => supported.includes(a)); if (at < 0) fail('ip 仅支持地址、路由、链路和邻居查询')
    const family = args.splice(at, 1)[0]
    const result = options(args, flags('-4', '-6', '-br', '-brief', '-o', '-s', '-j', '-json'), unit, 3)
    const selectors = [...result.operands]
    if (['show', 'list'].includes(selectors[0])) selectors.shift()
    if (selectors.length && !(selectors.length === 2 && selectors[0] === 'dev' && unit(selectors[1])) && !(selectors.length === 1 && ['route', 'r'].includes(family) && selectors[0] === 'default')) fail('ip 只支持列表及显式设备/默认路由筛选')
    return render(known[name], [...result.entries.map(e => e.name), family, 'show', ...selectors], '网络元数据')
  }
  if (name === 'top') {
    const result = options(args, { ...flags('-b', '-H'), '-n': s => /^[1-3]$/.test(s), '-d': s => /^[1-3]$/.test(s), '-p': s => /^[0-9]{1,9}(?:,[0-9]{1,9}){0,7}$/.test(s) })
    if (!result.used.has('-b') || !result.used.has('-n')) fail('top 必须使用批处理 -b 和有限次数 -n 1..3')
    return render(known[name], result.args, '进程快照')
  }
  if (name === 'vmstat') {
    const result = options(args, { ...flags('-s', '-d', '-w', '-a', '-t'), '-S': oneOf('K', 'k', 'M', 'm') }, s => /^[1-5]$/.test(s), 2)
    if (result.operands.length === 1) fail('持续采样必须同时限定间隔和次数')
    return render(known[name], result.args, '系统采样')
  }
  if (name === 'id' || name === 'whoami') return render(known[name], options(args, name === 'id' ? flags('-u', '-g', '-G', '-n', '-r') : {}).args, '当前身份查询')
  if (name === 'getconf') return render(known[name], options(args, {}, oneOf('_NPROCESSORS_ONLN', 'PAGESIZE', 'PAGE_SIZE', 'LONG_BIT'), 1).args, '系统参数查询')
  return undefined
}
