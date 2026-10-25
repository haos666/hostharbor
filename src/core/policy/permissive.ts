import type { PolicyDecision } from '../../shared/contracts'
import { permissiveShell } from './permissive-shell'

// Explicit default-allow authorization. These hints cannot establish that a
// script, remote endpoint, executable or environment is safe or non-destructive.
export function permissiveRisks(source: string, options: { denyPermissionChanges?: boolean } = {}): PolicyDecision['matchedRules'] {
  const found = new Map<string, PolicyDecision['matchedRules'][number]>()
  const add = (id: string, name: string) => found.set(id, { id: `permissive:${id}`, name, action: 'approval', risk: 'high' })
  let budget = 65536
  function scan(text: string, depth = 0) {
    if (depth > 8 || text.length > budget) return // bounded hints, never a safety claim
    budget -= text.length
    const { commands, nested } = permissiveShell(text)
    for (const child of nested) scan(child, depth + 1)
    for (const raw of commands) inspect(raw, depth)
  }
  function commandArgs(args: string[]) {
    const tail = [...args]
    while (tail[0]?.startsWith('-')) {
      const flag = tail.shift()!
      if (['-p', '--property', '-t', '--type', '--state', '--host', '-H', '--context', '--log-level', '-c', '-C', '-h', '--port', '-U', '--username', '-n', '--namespace', '-f', '--file', '--project-name', '-a', '--auth'].includes(flag)) tail.shift()
    }
    return tail
  }
  function inspect(raw: string[], depth: number) {
    if (depth > 8) return
    const words = [...raw]
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || ['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', 'function'].includes(words[0]))) words.shift()
    const name = words[0]?.split('/').at(-1) ?? '', args = words.slice(1)
    if (!name) return
    const operation = commandArgs(args)
    if (['rm', 'unlink', 'shred', 'rmdir', 'truncate', 'shutdown', 'reboot', 'poweroff', 'halt'].includes(name) && args.some(a => a === '--help' || a === '--version')) return
    if (['rsync', 'tar'].includes(name) && args.some(a => /^--delete(?:[=-]|$)/.test(a))) add('file-removal', '同步或归档删除文件')
    if (name === 'kill' && args.includes('-1')) add('power-control', '终止所有可访问进程')
    if (options.denyPermissionChanges && ['chmod', 'chown', 'chgrp', 'setfacl', 'chattr', 'useradd', 'usermod', 'passwd'].includes(name)) add('permissions', '已配置拒绝的权限或账号变更')
    if (['rm', 'unlink', 'shred', 'rmdir', 'truncate'].includes(name)) add('file-removal', '删除或清空文件、目录')
    if (/^(?:mkfs(?:\..*)?|mke2fs|wipefs|sfdisk)$/.test(name) || ['fdisk', 'parted'].includes(name) && !args.some(a => ['-l', '--list', 'print', '--help', '--version'].includes(a)) || name === 'dd' && args.some(a => /^of=\/dev\//.test(a))) add('disk-write', '擦除设备、格式化或修改分区')
    if (['shutdown', 'reboot', 'poweroff', 'halt'].includes(name) || ['init', 'telinit'].includes(name) && args.some(a => a === '0' || a === '6')) add('power-control', '整机重启或关机')
    if (name === 'systemctl' && (['reboot', 'poweroff', 'halt', 'kexec', 'soft-reboot', 'rescue', 'emergency'].includes(operation[0]) || ['start', 'isolate'].includes(operation[0]) && operation.slice(1).some(a => ['reboot.target', 'poweroff.target', 'halt.target'].includes(a)))) add('power-control', '系统重启、关机或维护模式')
    if (['userdel', 'groupdel'].includes(name)) add('file-removal', '删除系统账号或用户组')
    if (name === 'find' && args.includes('-delete')) add('file-removal', 'find 删除文件')
    if (['docker', 'podman'].includes(name)) {
      const compose = operation[0] === 'compose' ? commandArgs(operation.slice(1)) : []
      if (compose[0] === 'rm') add('file-removal', '删除Compose容器')
      if (['rm', 'rmi', 'prune'].includes(operation[0]) || ['container', 'image', 'volume', 'system', 'network', 'builder'].includes(operation[0]) && ['rm', 'prune'].includes(operation[1]) || operation[0] === 'compose' && operation.includes('down') && operation.some(a => ['-v', '--volumes', '--rmi'].includes(a))) add('file-removal', '删除容器、镜像或数据卷')
      const exec = args.indexOf('exec')
      if (exec >= 0) {
        const tail = args.slice(exec + 1)
        while (tail[0]?.startsWith('-')) { const flag = tail.shift(); if (['-u', '--user', '-w', '--workdir', '-e', '--env'].includes(flag!)) tail.shift() }
        tail.shift(); inspect(tail, depth + 1)
      }
    }
    if (name === 'git' && (['clean', 'rm'].includes(operation[0]) || operation[0] === 'reset' && operation.includes('--hard'))) add('file-removal', '删除仓库文件或丢弃工作区修改')
    if (['apt', 'apt-get', 'dnf', 'yum', 'apk', 'snap', 'brew', 'pip', 'pip3', 'npm', 'pnpm', 'yarn'].includes(name) && ['remove', 'purge', 'autoremove', 'uninstall', 'del'].includes(operation[0])) add('file-removal', '卸载或清理软件')
    if (name === 'rpm' && args.some(a => a === '--erase' || /^-[^-]*e/.test(a)) || name === 'dpkg' && args.some(a => ['--remove', '--purge'].includes(a) || /^-[^-]*[rP]/.test(a)) || name === 'pacman' && args.some(a => a === '--remove' || /^-[^-]*R/.test(a))) add('file-removal', '卸载软件包')
    if (/^python[\d.]*$/.test(name) && args[0] === '-m' && ['pip', 'pip3'].includes(args[1])) inspect(args.slice(1), depth + 1)
    if (name === 'redis-cli' && /^(?:FLUSHALL|FLUSHDB)$/i.test(operation[0] ?? '')) add('file-removal', '清空数据库')
    if (['mysql', 'mariadb', 'psql', 'sqlite3', 'mongosh'].includes(name) && args.some(a => /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE\s+(?:TABLE\s+)?\w+|DELETE\s+FROM\b|deleteMany\s*\(|dropDatabase\s*\()/i.test(a))) add('file-removal', '数据库删除或清空')
    if (/^(?:bash|sh|dash|zsh|ksh)$/.test(name) && args.some(a => /^-[a-z]*c[a-z]*$/.test(a))) {
      const flag = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a)); if (args[flag + 1]) scan(args[flag + 1], depth + 1)
    }
    if (name === 'su') { const flag = args.findIndex(a => a === '-c' || a === '--command'); if (args[flag + 1] && flag >= 0) scan(args[flag + 1], depth + 1) }
    if (name === 'ssh') { const tail = [...args]; while (tail[0]?.startsWith('-')) { const flag = tail.shift(); if (['-i', '-p', '-l', '-o', '-J', '-F'].includes(flag!)) tail.shift() }; tail.shift(); scan(tail.join(' '), depth + 1) }
    if (name === 'curl' && args.some((a, i) => a === '-X' && args[i + 1]?.toUpperCase() === 'DELETE' || /^(?:-X|--request=)DELETE$/i.test(a) || a === '--request' && args[i + 1]?.toUpperCase() === 'DELETE')) add('file-removal', 'HTTP DELETE 请求')
    if (name === 'eval') scan(args.join(' '), depth + 1)
    if (['command', 'exec', 'sudo', 'doas', 'env', 'nohup', 'setsid', 'nice', 'stdbuf', 'timeout', 'xargs', 'busybox', 'toybox', 'ionice'].includes(name)) {
      const tail = [...args]
      while (tail.length && (tail[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tail[0]))) {
        const flag = tail.shift()!
        if (['-u', '--user', '-g', '--group', '-C', '--chdir', '--adjustment', '-k', '--kill-after', '-s', '--signal', '-I', '-L', '-P', '--max-procs', '--max-args'].includes(flag) || flag === '-n' && ['nice', 'xargs'].includes(name)) tail.shift()
      }
      if (name === 'timeout') tail.shift()
      if (!(name === 'command' && args.some(a => a === '-v' || a === '-V'))) inspect(tail, depth + 1)
    }
    if (name === 'find') { const index = args.findIndex(a => ['-exec', '-execdir', '-ok', '-okdir'].includes(a)); if (index >= 0) inspect(args.slice(index + 1), depth + 1) }
    if (depth > 8) return
  }
  scan(source)
  return [...found.values()]
}
